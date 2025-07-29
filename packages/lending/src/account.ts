/**
 * Lending Account Management
 *
 * This module provides comprehensive account management functionality for the lending protocol.
 * It includes coin merging, health factor calculations, user state management, and various
 * lending operations like supply, borrow, withdraw, and repay.
 *
 * @module LendingAccount
 */

import type {
  UserLendingInfo,
  SuiClientOption,
  EnvOption,
  Pool,
  Transaction as NAVITransaction,
  AssetIdentifier,
  TransactionResult,
  CacheOption,
  AccountCap
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
import { getPool, getPools, PoolOperator } from './pool'

/**
 * Merges multiple coins into a single coin for transaction building
 *
 * This function takes multiple coin objects and merges them into a single coin
 * that can be used in a transaction. It supports optional splitting to create
 * a specific balance amount.
 *
 * @param tx - The transaction object to build
 * @param coins - Array of coin objects to merge
 * @param options - Optional parameters for balance splitting and gas coin usage
 * @returns Transaction result representing the merged coin
 */
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

  // Sort coins by balance (highest first) and collect valid coins
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

  // Handle SUI gas coin specially
  if (normalizeCoinType(coinType) === normalizeCoinType('0x2::sui::SUI') && options?.useGasCoin) {
    return needSplit ? tx.splitCoins(tx.gas, [tx.pure.u64(splitBalance)]) : tx.gas
  }

  // Merge coins and optionally split
  const coin =
    mergeList.length === 1
      ? tx.object(mergeList[0])
      : tx.mergeCoins(mergeList[0], mergeList.slice(1))

  return needSplit ? tx.splitCoins(coin, [tx.pure.u64(splitBalance)]) : coin
}

/**
 * Calculates dynamic health factor for a user after potential operations
 *
 * This function creates a transaction call to calculate the health factor
 * that would result after performing supply/borrow operations.
 *
 * @param tx - The transaction object to build
 * @param address - User address or transaction result
 * @param identifier - Asset identifier
 * @param estimatedSupply - Estimated supply amount
 * @param estimatedBorrow - Estimated borrow amount
 * @param isIncrease - Whether this is an increase operation
 * @param options - Environment options
 * @returns Transaction result for health factor calculation
 */
export async function getSimulatedHealthFactorPTB(
  tx: Transaction,
  address: string | AccountCap | TransactionResult,
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
    target: `${config.uiGetter}::calculator_unchecked::dynamic_health_factor`,
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

/**
 * Gets the current health factor for a user
 *
 * @param tx - The transaction object to build
 * @param address - User address or account cap or transaction result
 * @param options - Environment options
 * @returns Transaction result for health factor calculation
 */
export async function getHealthFactorPTB(
  tx: Transaction,
  address: string | AccountCap | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  return getSimulatedHealthFactorPTB(tx, address, 0, 0, 0, false, options)
}

/**
 * Retrieves the current lending state for a user
 *
 * This function fetches all active lending positions for a user, including
 * supply and borrow balances for different assets.
 *
 * @param address - User wallet address or account cap
 * @param options - Options for client, environment, and caching
 * @returns Promise<UserLendingInfo[]> - Array of user lending positions
 */
export const getLendingState = withCache(
  async (
    address: string | AccountCap,
    options?: Partial<SuiClientOption & EnvOption & CacheOption>
  ): Promise<UserLendingInfo[]> => {
    const config = await getConfig({
      ...options,
      cacheTime: DEFAULT_CACHE_TIME
    })
    const tx = new Transaction()
    const client = options?.client ?? suiClient

    const pools = await getPools(options)

    // Create transaction call to get user state
    tx.moveCall({
      target: `${config.uiGetter}::getter_unchecked::get_user_state`,
      arguments: [tx.object(config.storage), tx.pure.address(address!)]
    })

    // Execute dry run to get user state
    const result = await client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: address
    })

    // Parse the result and filter out zero balances
    const res = parseDevInspectResult<
      {
        supply_balance: string
        borrow_balance: string
        asset_id: number
      }[][]
    >(result, [bcs.vector(UserStateInfo)])

    const lendingStates = camelize(
      res[0].filter((item) => {
        return item.supply_balance !== '0' || item.borrow_balance !== '0'
      })
    ) as any as {
      supplyBalance: string
      borrowBalance: string
      assetId: number
    }[]

    return lendingStates
      .map((lendingState) => {
        const pool = pools.find((pool) => pool.id === lendingState.assetId)
        return {
          ...lendingState,
          pool
        }
      })
      .filter((lendingState) => !!lendingState.pool) as any
  }
)

/**
 * Calculates the current health factor for a user
 *
 * @param address - User wallet address or account cap
 * @param options - Options for client and environment
 * @returns Promise<number> - Health factor value
 */
export async function getHealthFactor(
  address: string | AccountCap,
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

/**
 * Calculates the health factor after performing lending operations
 *
 * This function simulates the health factor that would result after
 * performing a series of supply, withdraw, borrow, or repay operations.
 *
 * @param address - User wallet address or account cap
 * @param identifier - Asset identifier
 * @param operations - Array of operations to simulate
 * @param options - Options for client and environment
 * @returns Promise<number> - Projected health factor
 */
export async function getSimulatedHealthFactor(
  address: string | AccountCap,
  identifier: AssetIdentifier,
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
  const pool = await getPool(identifier, options)

  // Calculate estimated changes from operations
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

  // Validate operation consistency
  if (estimatedSupply * estimatedBorrow < 0) {
    throw new Error('Invalid operations')
  }

  // Determine if this is an increase operation
  const isIncrease = estimatedSupply > 0 || estimatedBorrow > 0

  // Calculate the dynamic health factor
  await getSimulatedHealthFactorPTB(
    tx,
    address,
    pool,
    Math.abs(estimatedSupply),
    Math.abs(estimatedBorrow),
    isIncrease,
    options
  )

  // Execute dry run to get the result
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<number[]>(result, [bcs.u256()])
  return processContractHealthFactor(Number(res[0]) || 0)
}

/**
 * Retrieves transaction history for a user from the Navi protocol API
 *
 * This function fetches the transaction history for a specific user address
 * from the Navi protocol's open API. It supports pagination through cursor-based navigation.
 *
 * @param address - User wallet address or account cap
 * @param options - Optional parameters including cursor for pagination
 * @returns Promise with transaction data and optional cursor for next page
 */
export const getTransactions = withSingleton(
  async (
    address: string | AccountCap,
    options?: {
      cursor?: string
    }
  ): Promise<{
    data: NAVITransaction[]
    cursor?: string
  }> => {
    // Build query parameters for the API request
    const params = new URLSearchParams()
    if (options?.cursor) {
      params.set('cursor', options.cursor)
    }
    params.set('userAddress', address)

    // Fetch transaction history from Navi protocol API
    const url = `https://open-api.naviprotocol.io/api/navi/user/transactions?${params.toString()}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  }
)

/**
 * Retrieves all coins owned by a user address
 *
 * This function fetches all coin objects owned by a specific address from the Sui blockchain.
 * It supports filtering by coin type and handles pagination automatically to retrieve all coins.
 *
 * @param address - User wallet address
 * @param options - Optional parameters including coin type filter and client options
 * @returns Promise<CoinStruct[]> - Array of coin objects owned by the address
 */
export async function getCoins(
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

  // Fetch all coins using pagination
  do {
    let res: PaginatedCoins

    // Use specific coin type filter if provided, otherwise get all coins
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

    // Break if no more data
    if (!res.data || !res.data.length) {
      break
    }

    // Collect coin data and continue with next page
    allCoinDatas.push(...res.data)
    cursor = res.nextCursor
  } while (cursor)

  return allCoinDatas
}
