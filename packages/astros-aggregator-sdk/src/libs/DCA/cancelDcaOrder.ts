/**
 * Cancel DCA Order Function
 *
 * Cancels an existing order using the receipt ID from backend API
 */

import { Transaction } from '@mysten/sui/transactions'
import { CancelDcaOrderParams } from './types'
import { AggregatorConfig } from '../Aggregator'
import { getDcaPackageId } from './getDcaPackageId'

/**
 * Cancels an existing DCA order and returns remaining funds
 *
 * @param params - Parameters for cancelling the DCA order
 * @param receiptId - The receipt object ID (from API response's receiptId field)
 * @param ownerAddress - Address to receive returned input/output coins
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 * @throws Error if parameters are invalid
 *
 * @example
 * ```typescript
 * // Get order with receiptId from backend API
 * const order = await getUserDcaOrders(userAddress, { status: 'active' })
 *
 * // Cancel using the receiptId from API response
 * const tx = await cancelDcaOrder(
 *   {
 *     fromCoinType: order.data[0].fromCoinType,
 *     toCoinType: order.data[0].toCoinType
 *   },
 *   order.data[0].receiptId,  // Receipt ID from backend API
 *   userAddress
 * )
 * ```
 */
export async function cancelDcaOrder(
  params: CancelDcaOrderParams,
  receiptId: string,
  ownerAddress: string
): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required. Get it from the backend API order response.')
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
