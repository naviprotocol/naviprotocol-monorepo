/**
 * Claim DCA Order Function
 *
 * Claims a completed DCA order and withdraws all funds
 */

import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../Aggregator'

/**
 * Claims a completed DCA order and withdraws all remaining funds
 *
 * @param receiptId - The receipt object ID from when the order was created
 * @param fromCoinType - The input coin type
 * @param toCoinType - The output coin type
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function claimDcaOrder(
  receiptId: string,
  fromCoinType: string,
  toCoinType: string
): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required')
  }

  if (!fromCoinType || !toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  const tx = new Transaction()

  const [remainingInput, totalOutput] = tx.moveCall({
    target: `${AggregatorConfig.dcaContract}::dca::claim_order`,
    arguments: [tx.object(AggregatorConfig.dcaRegistry), tx.object(receiptId)],
    typeArguments: [fromCoinType, toCoinType]
  })

  const inputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [remainingInput],
    typeArguments: [fromCoinType]
  })

  const outputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [totalOutput],
    typeArguments: [toCoinType]
  })

  return tx
}
