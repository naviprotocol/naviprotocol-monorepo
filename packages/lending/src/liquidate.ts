/**
 * Liquidation Functionality for Lending Protocol
 *
 * This module provides liquidation capabilities for the lending protocol.
 * Liquidation allows liquidators to repay a borrower's debt in exchange for their collateral
 * when the borrower's health factor falls below the liquidation threshold.
 */

import { AssetIdentifier, CoinObject, EnvOption, TransactionResult } from './types'
import { Transaction } from '@mysten/sui/transactions'
import { DEFAULT_CACHE_TIME, getConfig } from './config'
import { getPool } from './pool'
import { getAllFlashLoanAssets } from './flashloan'
import { normalizeCoinType, parseTxValue } from './utils'

/**
 * Create a liquidation transaction in the PTB (Programmable Transaction Block)
 *
 * This function allows liquidators to liquidate a borrower's position by repaying
 * their debt in exchange for their collateral. The liquidation process uses flash loans
 * to ensure atomic execution of the liquidation transaction.
 *
 * @param tx - The transaction block to add the liquidation operation to
 * @param payAsset - Asset identifier for the debt being repaid
 * @param payCoinObject - Coin object containing the debt repayment amount
 * @param collateralAsset - Asset identifier for the collateral being liquidated
 * @param liquidateAddress - Address of the borrower being liquidated
 * @param options - Optional environment configuration
 * @returns Tuple containing [collateralBalance, remainDebtBalance] where:
 *          - collateralBalance: The collateral received from liquidation
 *          - remainDebtBalance: Any remaining debt after liquidation
 * @throws Error if either pay asset or collateral asset does not support flash loans
 */
export async function liquidatePTB(
  tx: Transaction,
  payAsset: AssetIdentifier,
  payCoinObject: CoinObject,
  collateralAsset: AssetIdentifier,
  liquidateAddress: string | TransactionResult,
  options?: Partial<EnvOption>
) {
  const commonOptions = {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  }
  const config = await getConfig(commonOptions)
  const payPool = await getPool(payAsset, commonOptions)
  const collateralPool = await getPool(collateralAsset, commonOptions)

  // Execute the liquidation transaction
  const [collateralBalance, remainDebtBalance] = tx.moveCall({
    target: `${config.package}::incentive_v3::liquidation`,
    arguments: [
      tx.object('0x06'), // Clock object
      tx.object(config.priceOracle), // Price oracle for asset pricing
      tx.object(config.storage), // Protocol storage
      tx.pure.u8(payPool.id), // Pay asset ID
      tx.object(payPool.contract.pool), // Pay asset pool contract
      parseTxValue(payCoinObject, tx.object), // Debt repayment amount
      tx.pure.u8(collateralPool.id), // Collateral asset ID
      tx.object(collateralPool.contract.pool), // Collateral asset pool contract
      parseTxValue(liquidateAddress, tx.pure.address), // Borrower address
      tx.object(config.incentiveV2), // Incentive V2 contract
      tx.object(config.incentiveV3) // Incentive V3 contract
    ],
    typeArguments: [payPool.suiCoinType, collateralPool.suiCoinType]
  })

  return [collateralBalance, remainDebtBalance]
}
