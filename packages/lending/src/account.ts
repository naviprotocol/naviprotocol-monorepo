import type {
  UserLendingInfo,
  SuiClientOption,
  EnvOption,
  Pool,
  Transaction as NAVITransaction,
  AssetIdentifier,
  TransactionResult,
  CacheOption
} from './types'
import { Transaction } from '@mysten/sui/transactions'
import { UserStateInfo } from './bcs'
import { getConfig, DEFAULT_CACHE_TIME } from './config'
import {
  suiClient,
  camelize,
  parseDevInspectResult,
  withSingleton,
  processContractHealthFactor,
  parseTxVaule,
  parseTxPoolVaule,
  withCache,
  normalizeCoinType
} from './utils'
import { bcs } from '@mysten/sui/bcs'
import { CoinStruct, PaginatedCoins } from '@mysten/sui/client'
import { getPool, PoolOperator } from './pool'

export function mergeCoinsPTB(
  tx: Transaction,
  coins: ({
    balance: string | number | bigint
    coinObjectId: string
    coinType: string
  } & CoinStruct)[],
  options?: {
    balance?: number
    useGasCoin?: boolean
  }
) {
  const needSplit = typeof options?.balance === 'number'
  const splitBalance = needSplit ? options.balance! : 0
  let mergedBalance = 0
  const mergeList: string[] = []
  let coinType = ''
  coins
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .forEach((coin) => {
      if (needSplit && mergedBalance >= splitBalance) {
        return
      }
      if (Number(coin.balance) === 0) {
        return
      }
      if (!coinType) {
        coinType = coin.coinType
      }
      if (coinType !== coin.coinType) {
        throw new Error('All coins must be of the same type')
      }
      mergedBalance += Number(coin.balance)
      mergeList.push(coin.coinObjectId)
    })
  if (mergeList.length === 0) {
    throw new Error('No coins to merge')
  }
  if (needSplit && mergedBalance < splitBalance) {
    throw new Error(
      `Balance is less than the specified balance: ${mergedBalance} < ${splitBalance}`
    )
  }

  if (normalizeCoinType(coinType) === normalizeCoinType('0x2::sui::SUI')) {
    return needSplit && !options?.useGasCoin
      ? tx.splitCoins(tx.gas, [tx.pure.u64(splitBalance)])
      : tx.gas
  }

  const coin =
    mergeList.length == 1
      ? tx.object(mergeList[0])
      : tx.mergeCoins(mergeList[0], mergeList.slice(1))

  return needSplit ? tx.splitCoins(coin, [tx.pure.u64(splitBalance)]) : coin
}

export async function getHealthFactorPTB(
  tx: Transaction,
  address: string | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return tx.moveCall({
    target: `${config.package}::logic::user_health_factor`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(config.oracle.priceOracle),
      parseTxVaule(address, tx.pure.address)
    ]
  })
}

export async function getDynamicHealthFactorPTB(
  tx: Transaction,
  address: string | TransactionResult,
  identifier: AssetIdentifier,
  estimatedSupply: number | TransactionResult,
  estimatedBorrow: number | TransactionResult,
  isIncrease: boolean | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)
  return tx.moveCall({
    target: `${config.package}::dynamic_calculator::dynamic_health_factor`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(config.oracle.priceOracle),
      parseTxPoolVaule(tx, pool),
      parseTxVaule(address, tx.pure.address),
      parseTxVaule(pool.id, tx.pure.u8),
      parseTxVaule(estimatedSupply, tx.pure.u64),
      parseTxVaule(estimatedBorrow, tx.pure.u64),
      parseTxVaule(isIncrease, tx.pure.bool)
    ],
    typeArguments: [pool.suiCoinType]
  })
}

export const getUserLendingState = withCache(
  async (
    address: string,
    options?: Partial<SuiClientOption & EnvOption & CacheOption>
  ): Promise<UserLendingInfo[]> => {
    const config = await getConfig({
      ...options,
      cacheTime: DEFAULT_CACHE_TIME
    })
    const tx = new Transaction()
    const client = options?.client ?? suiClient
    tx.moveCall({
      target: `${config.uiGetter}::getter::get_user_state`,
      arguments: [tx.object(config.storage), tx.pure.address(address!)]
    })
    const result = await client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: address
    })
    const res = parseDevInspectResult<
      {
        supply_balance: string
        borrow_balance: string
        asset_id: number
      }[][]
    >(result, [bcs.vector(UserStateInfo)])
    return camelize(
      res[0].filter((item) => {
        return item.supply_balance !== '0' || item.borrow_balance !== '0'
      })
    ) as any
  }
)

export async function getUserHealthFactor(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  const client = options?.client ?? suiClient
  const tx = new Transaction()
  await getHealthFactorPTB(tx, address, options)
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<number[]>(result, [bcs.u256()])
  return processContractHealthFactor(Number(res[0]) || 0)
}

export async function getUserDynamicHealthFactorAfterOperator(
  address: string,
  pool: Pool,
  operations: {
    type: PoolOperator
    amount: number
  }[],
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  const client = options?.client ?? suiClient
  const tx = new Transaction()
  let estimatedSupply = 0
  let estimatedBorrow = 0
  operations.forEach((operation) => {
    if (operation.type === PoolOperator.Supply) {
      estimatedSupply += operation.amount
    } else if (operation.type === PoolOperator.Withdraw) {
      estimatedSupply -= operation.amount
    } else if (operation.type === PoolOperator.Borrow) {
      estimatedBorrow += operation.amount
    } else if (operation.type === PoolOperator.Repay) {
      estimatedBorrow -= operation.amount
    }
  })
  if (estimatedSupply * estimatedBorrow < 0) {
    throw new Error('Invalid operations')
  }
  const isIncrease = estimatedSupply > 0 || estimatedBorrow > 0
  await getDynamicHealthFactorPTB(
    tx,
    address,
    pool,
    Math.abs(estimatedSupply),
    Math.abs(estimatedBorrow),
    isIncrease,
    options
  )
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<number[]>(result, [bcs.u256()])
  return processContractHealthFactor(Number(res[0]) || 0)
}

export const getUserTransactions = withSingleton(
  async (
    address: string,
    options?: {
      cursor?: string
    }
  ): Promise<{
    data: NAVITransaction[]
    cursor?: string
  }> => {
    const params = new URLSearchParams()
    if (options?.cursor) {
      params.set('cursor', options.cursor)
    }
    params.set('userAddress', address)
    const url = `https://open-api.naviprotocol.io/api/navi/user/transactions?${params.toString()}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  }
)

export async function getUserCoins(
  address: string,
  options?: Partial<
    {
      coinType?: string
    } & SuiClientOption
  >
): Promise<CoinStruct[]> {
  let cursor: string | undefined | null = null
  const allCoinDatas: CoinStruct[] = []
  const client = options?.client ?? suiClient
  do {
    let res: PaginatedCoins
    if (options?.coinType) {
      res = await client.getCoins({
        owner: address,
        coinType: options?.coinType,
        cursor,
        limit: 100
      })
    } else {
      res = await client.getAllCoins({
        owner: address,
        cursor,
        limit: 100
      })
    }
    if (!res.data || !res.data.length) {
      break
    }
    allCoinDatas.push(...res.data)
    cursor = res.nextCursor
  } while (cursor)
  return allCoinDatas
}
