/**
 * Lending Pool Operations
 *
 * This module provides comprehensive pool management functionality for the lending protocol.
 * It handles pool information retrieval, deposit/withdraw operations, borrow/repay operations,
 * and various pool-related utilities and statistics.
 *
 * @module LendingPool
 */

import { DEFAULT_CACHE_TIME, getConfig } from './config'
import type {
  EnvOption,
  CacheOption,
  Pool,
  AssetIdentifier,
  PoolStats,
  FeeDetail,
  CoinObject,
  TransactionResult,
  AccountCapOption
} from './types'
import { normalizeCoinType, withCache, withSingleton, parseTxVaule } from './utils'
import { Transaction } from '@mysten/sui/transactions'

/**
 * Enumeration of pool operations
 *
 * This enum defines the different types of operations that can be performed
 * on lending pools, used for health factor calculations and operation tracking.
 */
export enum PoolOperator {
  /** Supply/deposit operation */
  Supply = 1,
  /** Withdraw operation */
  Withdraw = 2,
  /** Borrow operation */
  Borrow = 3,
  /** Repay operation */
  Repay = 4
}

/**
 * Fetches all available lending pools
 *
 * This function retrieves the complete list of lending pools from the Navi protocol API.
 * It's wrapped with caching and singleton behavior for efficient data access.
 *
 * @param options - Optional environment and caching options
 * @returns Promise<Pool[]> - Array of all available lending pools
 */
export const getPools = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<Pool[]> => {
    const url = `https://open-api.naviprotocol.io/api/navi/pools?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

/**
 * Gets information for a specific lending pool
 *
 * This function retrieves pool information based on various identifier types:
 * - Pool object (returns directly)
 * - String (coin type - normalized for comparison)
 * - Number (pool ID)
 *
 * @param identifier - Asset identifier (string, Pool object, or number)
 * @param options - Optional environment options
 * @returns Promise<Pool> - Pool information
 * @throws Error if pool is not found
 */
export async function getPool(
  identifier: AssetIdentifier,
  options?: Partial<EnvOption>
): Promise<Pool> {
  const pools = await getPools({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  // If identifier is already a pool object, return it directly
  if (typeof identifier === 'object') {
    return identifier
  }

  // Find pool by identifier
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

/**
 * Fetches protocol statistics
 *
 * This function retrieves overall protocol statistics including TVL,
 * total borrow amounts, and other key metrics.
 *
 * @param options - Optional caching options
 * @returns Promise<PoolStats> - Protocol statistics
 */
export const getStats = withCache(
  withSingleton(async (options?: Partial<CacheOption>): Promise<PoolStats> => {
    const url = `https://open-api.naviprotocol.io/api/navi/stats`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

/**
 * Fetches protocol fee information
 *
 * This function retrieves detailed fee information including:
 * - Total fee value
 * - V3 borrow fees
 * - Borrow interest fees
 * - Flash loan and liquidation fees
 *
 * @param options - Optional caching options
 * @returns Promise with detailed fee breakdown
 */
export const getFees = withCache(
  withSingleton(
    async (
      options?: Partial<CacheOption>
    ): Promise<{
      totalValue: number
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

/**
 * Builds a deposit transaction for a lending pool
 *
 * This function creates a transaction block for depositing coins into a lending pool.
 * It handles both regular deposits and deposits with account capabilities,
 * and includes special handling for SUI gas coins.
 *
 * @param tx - Transaction object to build
 * @param identifier - Asset identifier for the pool
 * @param coinObject - Coin object to deposit
 * @param options - Optional parameters including environment, account capability, and amount
 * @returns Promise<Transaction> - Transaction with deposit operation
 */
export async function depositCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  coinObject: CoinObject,
  options?: Partial<
    EnvOption &
      AccountCapOption & {
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

  // Handle SUI gas coin deposits
  if (normalizeCoinType(pool.suiCoinType) === normalizeCoinType('0x2::sui::SUI') && isGasCoin) {
    if (!options?.amount) {
      throw new Error('Amount is required for sui coin')
    }
    coinObject = tx.splitCoins(coinObject, [options.amount])
  }

  // Determine deposit amount
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

  // Build deposit transaction based on account capability
  if (options?.accountCap) {
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
        parseTxVaule(options.accountCap, tx.object)
      ],
      typeArguments: [pool.suiCoinType]
    })
  } else {
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
  }

  return tx
}

/**
 * Builds a withdraw transaction for a lending pool
 *
 * This function creates a transaction block for withdrawing coins from a lending pool.
 * It handles both regular withdrawals and withdrawals with account capabilities.
 *
 * @param tx - Transaction object to build
 * @param identifier - Asset identifier for the pool
 * @param amount - Amount to withdraw
 * @param options - Optional parameters including environment and account capability
 * @returns Transaction result representing the withdrawn coins
 */
export async function withdrawCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  amount: number | TransactionResult,
  options?: Partial<EnvOption & AccountCapOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const withdrawAmount = parseTxVaule(amount, tx.pure.u64)

  let withdrawBalance

  // Build withdraw transaction based on account capability
  if (options?.accountCap) {
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
        parseTxVaule(options.accountCap, tx.object)
      ],
      typeArguments: [pool.suiCoinType]
    })
    withdrawBalance = ret
  } else {
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
    withdrawBalance = ret
  }

  const withdrawCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [withdrawBalance],
    typeArguments: [pool.suiCoinType]
  })

  return withdrawCoin
}

export async function borrowCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  amount: number | TransactionResult,
  options?: Partial<EnvOption & AccountCapOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const borrowAmount = parseTxVaule(amount, tx.pure.u64)

  let borrowBalance

  if (!options?.accountCap) {
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
    borrowBalance = ret
  } else {
    const [ret] = tx.moveCall({
      target: `${config.package}::incentive_v3::borrow_with_account_cap`,
      arguments: [
        tx.object('0x06'),
        tx.object(config.priceOracle),
        tx.object(config.storage),
        tx.object(pool.contract.pool),
        tx.pure.u8(pool.id),
        borrowAmount,
        tx.object(config.incentiveV2),
        tx.object(config.incentiveV3),
        parseTxVaule(options.accountCap, tx.object)
      ],
      typeArguments: [pool.suiCoinType]
    })
    borrowBalance = ret
  }

  const coin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [tx.object(borrowBalance)],
    typeArguments: [pool.suiCoinType]
  })

  return coin
}

export async function repayCoinPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  coinObject: CoinObject,
  options?: Partial<
    EnvOption &
      AccountCapOption & {
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

  if (options?.accountCap) {
    tx.moveCall({
      target: `${config.package}::incentive_v3::repay_with_account_cap`,
      arguments: [
        tx.object('0x06'),
        tx.object(config.priceOracle),
        tx.object(config.storage),
        tx.object(pool.contract.pool),
        tx.pure.u8(pool.id),
        parseTxVaule(coinObject, tx.object),
        repayAmount,
        tx.object(config.incentiveV2),
        tx.object(config.incentiveV3),
        parseTxVaule(options.accountCap, tx.object)
      ],
      typeArguments: [pool.suiCoinType]
    })
  } else {
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
  }

  return tx
}
