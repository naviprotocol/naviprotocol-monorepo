import { DEFAULT_CACHE_TIME, getConfig } from './config'
import type {
  EnvOption,
  CacheOption,
  Pool,
  AssetIdentifier,
  PoolStats,
  FeeDetail,
  CoinObject,
  TransactionResult
} from './types'
import { normalizeCoinType, withCache, withSingleton, parseTxVaule } from './utils'
import { Transaction } from '@mysten/sui/transactions'

export enum PoolOperator {
  Supply = 1,
  Withdraw = 2,
  Borrow = 3,
  Repay = 4
}

export const getPools = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<Pool[]> => {
    const url = `https://open-api.naviprotocol.io/api/navi/pools?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

export async function getPool(
  identifier: AssetIdentifier,
  options?: Partial<EnvOption>
): Promise<Pool> {
  const pools = await getPools({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (typeof identifier === 'object') {
    return identifier
  }
  const pool = pools.find((p) => {
    if (typeof identifier === 'string') {
      return normalizeCoinType(p.suiCoinType) === normalizeCoinType(identifier)
    }
    if (typeof identifier === 'number') {
      return p.id === identifier
    }
    return false
  })
  if (!pool) {
    throw new Error(`Pool not found`)
  }
  return pool
}

export const getStats = withCache(
  withSingleton(async (options?: Partial<CacheOption>): Promise<PoolStats> => {
    const url = `https://open-api.naviprotocol.io/api/navi/stats`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

export const getFees = withCache(
  withSingleton(
    async (
      options?: Partial<CacheOption>
    ): Promise<{
      totalValue: string
      v3BorrowFee: {
        totalValue: number
        details: FeeDetail[]
      }
      borrowInterestFee: {
        totalValue: number
        details: FeeDetail[]
      }
      flashloanAndLiquidationFee: {
        totalValue: number
        details: FeeDetail[]
      }
    }> => {
      const url = `https://open-api.naviprotocol.io/api/navi/fee`
      const res = await fetch(url).then((res) => res.json())
      return res
    }
  )
)

export async function depositCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  coinObject: CoinObject,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)
  const isGasCoin = typeof coinObject === 'object' && coinObject.$kind === 'GasCoin'

  if (normalizeCoinType(pool.suiCoinType) === normalizeCoinType('0x2::sui::SUI') && isGasCoin) {
    if (!options?.amount) {
      throw new Error('Amount is required for sui coin')
    }
    coinObject = tx.splitCoins(coinObject, [options.amount])
  }

  let depositAmount: TransactionResult

  if (typeof options?.amount !== 'undefined') {
    depositAmount = parseTxVaule(options.amount, tx.pure.u64)
  } else {
    depositAmount = tx.moveCall({
      target: '0x2::coin::value',
      arguments: [parseTxVaule(coinObject as any, tx.object)],
      typeArguments: [pool.suiCoinType]
    })
  }

  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_deposit`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      parseTxVaule(coinObject, tx.object),
      depositAmount,
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3)
    ],
    typeArguments: [pool.suiCoinType]
  })
  return tx
}

export async function depositCoinWithAccountCapPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  coinObject: CoinObject,
  account: string | TransactionResult,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)
  const isGasCoin = typeof coinObject === 'object' && coinObject.$kind === 'GasCoin'

  if (normalizeCoinType(pool.suiCoinType) === normalizeCoinType('0x2::sui::SUI') && isGasCoin) {
    if (!options?.amount) {
      throw new Error('Amount is required for sui coin')
    }
    coinObject = tx.splitCoins(coinObject, [options.amount])
  }

  tx.moveCall({
    target: `${config.package}::incentive_v3::deposit_with_account_cap`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      parseTxVaule(coinObject, tx.object),
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3),
      parseTxVaule(account, tx.object)
    ],
    typeArguments: [pool.suiCoinType]
  })
  return tx
}

export async function withdrawCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const withdrawAmount = parseTxVaule(amount, tx.pure.u64)

  const [ret] = tx.moveCall({
    target: `${config.package}::incentive_v3::withdraw`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      withdrawAmount,
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3)
    ],
    typeArguments: [pool.suiCoinType]
  })

  const withdrawCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [ret],
    typeArguments: [pool.suiCoinType]
  })

  return withdrawCoin
}

export async function withdrawCoinWithAccountCapPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  account: string | TransactionResult,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const withdrawAmount = parseTxVaule(amount, tx.pure.u64)

  const [ret] = tx.moveCall({
    target: `${config.package}::incentive_v3::withdraw_with_account_cap`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      withdrawAmount,
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3),
      parseTxVaule(account, tx.object)
    ],
    typeArguments: [pool.suiCoinType]
  })

  const [coin] = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [tx.object(ret)],
    typeArguments: [pool.suiCoinType]
  })

  return coin
}

export async function borrowCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const borrowAmount = parseTxVaule(amount, tx.pure.u64)
  const [ret] = tx.moveCall({
    target: `${config.package}::incentive_v3::borrow`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      borrowAmount,
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3)
    ],
    typeArguments: [pool.suiCoinType]
  })

  const coin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [tx.object(ret)],
    typeArguments: [pool.suiCoinType]
  })

  return coin
}

export async function repayCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  coinObject: CoinObject,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)
  const isGasCoin = typeof coinObject === 'object' && coinObject.$kind === 'GasCoin'

  if (normalizeCoinType(pool.suiCoinType) === normalizeCoinType('0x2::sui::SUI') && isGasCoin) {
    if (!options?.amount) {
      throw new Error('Amount is required for sui coin')
    }
    coinObject = tx.splitCoins(coinObject, [options.amount])
  }

  let repayAmount: TransactionResult

  if (typeof options?.amount !== 'undefined') {
    repayAmount = parseTxVaule(options.amount, tx.pure.u64)
  } else {
    repayAmount = tx.moveCall({
      target: '0x2::coin::value',
      arguments: [parseTxVaule(coinObject as any, tx.object)],
      typeArguments: [pool.suiCoinType]
    })
  }

  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_repay`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      parseTxVaule(coinObject, tx.object),
      repayAmount,
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3)
    ],
    typeArguments: [pool.suiCoinType]
  })

  return tx
}
