/**
 * Cancel DCA Order Function
 *
 * Cancels an existing order using the receipt
 */

import { Transaction } from '@mysten/sui/transactions'
import { CancelDcaOrderParams } from './types'
import { AggregatorConfig } from '../Aggregator'
import { getDcaPackageId } from './getDcaPackageId'

/**
 * Cancels an existing DCA order and returns remaining funds
 *
 * @param params - Parameters for cancelling the DCA order
 * @param receiptId - The receipt object ID from when the order was created
 * @param ownerAddress - Address to receive returned input/output coins
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function cancelDcaOrder(
  params: CancelDcaOrderParams,
  receiptId: string,
  ownerAddress: string
): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required')
  }

  if (!params.fromCoinType || !params.toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  const tx = new Transaction()

  const [remainingInput, accumulatedOutput] = tx.moveCall({
    target: `${getDcaPackageId()}::main::cancel_order`,
    arguments: [
      tx.object(AggregatorConfig.dcaGlobalConfig),
      tx.object(AggregatorConfig.dcaRegistry),
      tx.object(receiptId),
      tx.object('0x6')
    ],
    typeArguments: [params.fromCoinType, params.toCoinType]
  })

  const inputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [remainingInput],
    typeArguments: [params.fromCoinType]
  })

  const outputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [accumulatedOutput],
    typeArguments: [params.toCoinType]
  })

  // Ensure returned coins are transferred to the owner to avoid unused value errors
  tx.transferObjects([inputCoin, outputCoin], tx.pure.address(ownerAddress))

  return tx
}
