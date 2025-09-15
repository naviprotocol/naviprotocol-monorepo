/**
 * Withdraw Output Functions
 *
 * Withdraws accumulated output tokens from an active DCA order
 */

import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../Aggregator'

/**
 * Withdraws all accumulated output tokens from an active DCA order
 *
 * @param receiptId - The receipt object ID from when the order was created
 * @param toCoinType - The output coin type to withdraw
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function withdrawOutput(receiptId: string, toCoinType: string): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required')
  }

  if (!toCoinType) {
    throw new Error('toCoinType is required')
  }

  const tx = new Transaction()

  const outputBalance = tx.moveCall({
    target: `${AggregatorConfig.dcaContract}::dca::withdraw_output`,
    arguments: [tx.object(AggregatorConfig.dcaRegistry), tx.object(receiptId)],
    typeArguments: [toCoinType]
  })

  const outputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [outputBalance],
    typeArguments: [toCoinType]
  })

  return tx
}

/**
 * Withdraws a specific amount of accumulated output tokens from an active DCA order
 *
 * @param receiptId - The receipt object ID from when the order was created
 * @param amount - The amount to withdraw (in the smallest unit of the coin)
 * @param toCoinType - The output coin type to withdraw
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function withdrawOutputAmount(
  receiptId: string,
  amount: string | number | bigint,
  toCoinType: string
): Promise<Transaction> {
  if (!receiptId) {
    throw new Error('receiptId is required')
  }

  if (!toCoinType) {
    throw new Error('toCoinType is required')
  }

  if (!amount || BigInt(amount) <= 0n) {
    throw new Error('amount must be greater than 0')
  }

  const tx = new Transaction()

  const outputBalance = tx.moveCall({
    target: `${AggregatorConfig.dcaContract}::dca::withdraw_output_amount`,
    arguments: [
      tx.object(AggregatorConfig.dcaRegistry),
      tx.object(receiptId),
      tx.pure.u64(amount.toString())
    ],
    typeArguments: [toCoinType]
  })

  const outputCoin = tx.moveCall({
    target: `0x2::coin::from_balance`,
    arguments: [outputBalance],
    typeArguments: [toCoinType]
  })

  return tx
}
