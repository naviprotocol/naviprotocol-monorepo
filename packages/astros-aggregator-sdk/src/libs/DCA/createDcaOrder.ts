/**
 * Create DCA Order Function
 */

import { Transaction } from '@mysten/sui/transactions'
import { DcaOrderParams } from './types'
import { AggregatorConfig } from '../Aggregator'
import { getDcaPackageId } from './getDcaPackageId'

/**
 * Creates a new DCA order with the specified parameters
 *
 * @param params - DCA order configuration parameters
 * @param coinObjectId - Coin object ID
 * @param ownerAddress - Address to receive the Receipt object
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function createDcaOrder(
  params: DcaOrderParams,
  coinObjectId: string,
  ownerAddress: string
): Promise<Transaction> {
  if (!params.fromCoinType || !params.toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  if (params.orderNum <= 0) {
    throw new Error('orderNum must be greater than 0')
  }

  if (params.gapDurationMs <= 0) {
    throw new Error('gapDurationMs must be greater than 0')
  }

  if (!coinObjectId) {
    throw new Error('coinObjectId is required for the deposit')
  }

  const tx = new Transaction()

  const [depositCoin] = tx.splitCoins(tx.object(coinObjectId), [params.depositedAmount])

  const balance = tx.moveCall({
    target: `0x2::coin::into_balance`,
    arguments: [depositCoin],
    typeArguments: [params.fromCoinType]
  })

  const receipt = tx.moveCall({
    target: `${getDcaPackageId()}::main::create_order`,
    arguments: [
      tx.object(AggregatorConfig.dcaGlobalConfig),
      tx.object(AggregatorConfig.dcaRegistry),
      balance,
      tx.pure.u64(params.gapDurationMs),
      tx.pure.u64(params.orderNum),
      tx.pure.u64(params.cliffDurationMs),
      tx.pure.u64(params.minAmountOut),
      tx.pure.u64(params.maxAmountOut),
      tx.object('0x6')
    ],
    typeArguments: [params.fromCoinType, params.toCoinType]
  })

  // Ensure the created Receipt object is transferred to the owner to avoid unused value error
  tx.transferObjects([receipt], tx.pure.address(ownerAddress))

  return tx
}
