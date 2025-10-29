/**
 * Cancel DCA Order Function
 *
 * Cancels an existing order using the receipt ID from backend API
 */

import { Transaction } from '@mysten/sui/transactions'
import { CancelDcaOrderParams, DcaOptions } from './types'
import { getDcaConfig } from './getDcaConfig'

/**
 * Cancels an existing DCA order and returns remaining funds
 *
 * @param params - Parameters for cancelling the DCA order
 * @param receiptId - The receipt object ID (from API response's receiptId field)
 * @param ownerAddress - Address to receive returned input/output coins
 * @param dcaOptions - Optional DCA contract configuration overrides (for testing)
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 * @throws Error if parameters are invalid
 *
 * @example
 * ```typescript
 * // Get order with receiptId from backend API
 * const order = await getUserDcaOrders(userAddress, { status: 'active' })
 *
 * // Use default production config
 * const tx = await cancelDcaOrder(
 *   {
 *     fromCoinType: order.data[0].fromCoinType,
 *     toCoinType: order.data[0].toCoinType
 *   },
 *   order.data[0].receiptId,  // Receipt ID from backend API
 *   userAddress
 * )
 *
 * // Override for testing environment
 * const testTx = await cancelDcaOrder(
 *   { fromCoinType, toCoinType },
 *   receiptId,
 *   userAddress,
 *   {
 *     dcaContract: '0xTEST_PACKAGE_ID',
 *     dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
 *     dcaRegistry: '0xTEST_REGISTRY'
 *   }
 * )
 * ```
 */
export async function cancelDcaOrder(
  params: CancelDcaOrderParams,
  receiptId: string,
  ownerAddress: string,
  dcaOptions?: DcaOptions
): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required. Get it from the backend API order response.')
  }

  if (!params.fromCoinType || !params.toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  // Get DCA configuration (with optional overrides)
  const dcaConfig = getDcaConfig(dcaOptions)

  const tx = new Transaction()

  const [remainingInput, accumulatedOutput] = tx.moveCall({
    target: `${dcaConfig.dcaContract}::main::cancel_order`,
    arguments: [
      tx.object(dcaConfig.dcaGlobalConfig),
      tx.object(dcaConfig.dcaRegistry),
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
