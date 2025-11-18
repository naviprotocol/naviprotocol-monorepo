/**
 * Flash Loan Functionality for Lending Protocol
 *
 * This module provides flash loan capabilities for the lending protocol.
 * Flash loans allow users to borrow assets without collateral for a single transaction,
 * as long as the borrowed amount is repaid within the same transaction.
 */

import type { Transaction } from '@mysten/sui/transactions'
import type {
  EnvOption,
  AssetIdentifier,
  CoinObject,
  CacheOption,
  FloashloanAsset,
  TransactionResult
} from './types'
import { DEFAULT_CACHE_TIME, getConfig } from './config'
import { parseTxValue, normalizeCoinType, withCache, withSingleton } from './utils'
import { getPool } from './pool'

/**
 * Get all available flash loan assets from the API
 * Uses caching to avoid repeated API calls
 *
 * @param options - Optional environment and cache configuration
 * @returns Array of flash loan asset configurations
 */
export const getAllFlashLoanAssets = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<FloashloanAsset[]> => {
    const url = `https://open-api.naviprotocol.io/api/navi/flashloan?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return Object.keys(res.data).map((coinType) => {
      return {
        ...res.data[coinType],
        coinType
      }
    })
  })
)

/**
 * Get a specific flash loan asset by identifier
 *
 * @param identifier - Asset identifier (string coin type, number asset ID, or object with id)
 * @param options - Optional environment configuration
 * @returns Flash loan asset configuration or null if not found
 */
export async function getFlashLoanAsset(
  identifier: AssetIdentifier,
  options?: Partial<EnvOption>
): Promise<FloashloanAsset | null> {
  const assets = await getAllFlashLoanAssets(options)
  return (
    assets.find((asset) => {
      if (typeof identifier === 'string') {
        return normalizeCoinType(asset.coinType) === normalizeCoinType(identifier)
      }
      if (typeof identifier === 'number') {
        return asset.assetId === identifier
      }
      return asset.assetId === identifier.id
    }) || null
  )
}

/**
 * Create a flash loan transaction in the PTB (Programmable Transaction Block)
 *
 * This function initiates a flash loan by borrowing the specified amount of assets.
 * The borrowed assets must be repaid within the same transaction using repayFlashLoanPTB.
 *
 * @param tx - The transaction block to add the flash loan operation to
 * @param identifier - Asset identifier to borrow
 * @param amount - Amount to borrow (number or transaction result)
 * @param options - Optional environment configuration
 * @returns Tuple containing [balance, receipt] where receipt is needed for repayment
 * @throws Error if the pool does not support flash loans
 */
export async function flashloanPTB(
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

  const flashLoanAssets = await getAllFlashLoanAssets({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const isSupport = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(pool.suiCoinType)
  )

  if (!isSupport) {
    throw new Error('Pool does not support flashloan')
  }

  if (config.version === 1) {
    const [balance, receipt] = tx.moveCall({
      target: `${config.package}::lending::flash_loan_with_ctx`,
      arguments: [
        tx.object(config.flashloanConfig),
        tx.object(pool.contract.pool),
        parseTxValue(amount, tx.pure.u64)
      ],
      typeArguments: [pool.suiCoinType]
    })

    return [balance, receipt]
  } else {
    const [balance, receipt] = tx.moveCall({
      target: `${config.package}::lending::flash_loan_with_ctx_v2`,
      arguments: [
        tx.object(config.flashloanConfig),
        tx.object(pool.contract.pool),
        parseTxValue(amount, tx.pure.u64),
        tx.object('0x05')
      ],
      typeArguments: [pool.suiCoinType]
    })

    return [balance, receipt]
  }
}

/**
 * Repay a flash loan transaction in the PTB
 *
 * This function repays the flash loan using the receipt from the original flash loan
 * and the coin object containing the repayment amount.
 *
 * @param tx - The transaction block to add the repayment operation to
 * @param identifier - Asset identifier being repaid
 * @param receipt - Receipt from the original flash loan transaction
 * @param coinObject - Coin object containing the repayment amount
 * @param options - Optional environment configuration
 * @returns Tuple containing [balance] after repayment
 * @throws Error if the pool does not support flash loans
 */
export async function repayFlashLoanPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  receipt: TransactionResult | string,
  coinObject: CoinObject,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const flashLoanAssets = await getAllFlashLoanAssets({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const isSupport = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(pool.suiCoinType)
  )

  if (!isSupport) {
    throw new Error('Pool does not support flashloan')
  }

  // v2 entry is not required to repay
  const [balance] = tx.moveCall({
    target: `${config.package}::lending::flash_repay_with_ctx`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      parseTxValue(receipt, tx.object),
      parseTxValue(coinObject, tx.object)
    ],
    typeArguments: [pool.suiCoinType]
  })
  return [balance]
}
