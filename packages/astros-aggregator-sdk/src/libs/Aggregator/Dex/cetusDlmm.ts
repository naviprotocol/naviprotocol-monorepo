import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * Cetus DLMM: calls the protocol package directly (no Cetus aggregator wrapper, no partner).
 *
 *   pool::flash_swap<A, B>(pool, a2b, by_amount_in = true, amount, GlobalConfig, Versioned, Clock)
 *     -> (Balance<A>, Balance<B>, FlashSwapReceipt)
 *   pool::repay_flash_swap<A, B>(pool, Balance<A>, Balance<B>, receipt, Versioned)
 *
 * `flash_swap` passes partner = 0x0 and ref fee rate = 0, so no partner fee is taken. For an exact-in
 * swap the receipt's pay_amount equals `amount`, which is the whole input coin, so the whole input
 * balance is repaid (repay requires the paid balance to equal pay_amount exactly).
 * `cetusDlmmPublishedAt` must be the latest package: versioned::check_version aborts in any package
 * whose version constant is below Versioned.version.
 *
 * @returns the output coin
 */
export async function makeCetusDlmmPTB(
  txb: Transaction,
  coinTypeA: string,
  coinTypeB: string,
  pool: string,
  coinIn: any,
  amount: any,
  a2b: boolean
) {
  const typeArguments = [coinTypeA, coinTypeB]
  const balanceIn = txb.moveCall({
    target: '0x2::coin::into_balance',
    typeArguments: [a2b ? coinTypeA : coinTypeB],
    arguments: [coinIn]
  })

  const [balanceA, balanceB, receipt] = txb.moveCall({
    target: `${AggregatorConfig.cetusDlmmPublishedAt}::pool::flash_swap`,
    typeArguments,
    arguments: [
      txb.object(pool),
      txb.pure.bool(a2b),
      txb.pure.bool(true),
      amount,
      txb.object(AggregatorConfig.cetusDlmmGlobalConfig),
      txb.object(AggregatorConfig.cetusDlmmVersioned),
      txb.object(AggregatorConfig.clockAddress)
    ]
  })

  const zeroOther = txb.moveCall({
    target: '0x2::balance::zero',
    typeArguments: [a2b ? coinTypeB : coinTypeA]
  })
  txb.moveCall({
    target: `${AggregatorConfig.cetusDlmmPublishedAt}::pool::repay_flash_swap`,
    typeArguments,
    arguments: [
      txb.object(pool),
      a2b ? balanceIn : zeroOther,
      a2b ? zeroOther : balanceIn,
      receipt,
      txb.object(AggregatorConfig.cetusDlmmVersioned)
    ]
  })

  // The input-side balance returned by flash_swap is always zero.
  txb.moveCall({
    target: '0x2::balance::destroy_zero',
    typeArguments: [a2b ? coinTypeA : coinTypeB],
    arguments: [a2b ? balanceA : balanceB]
  })
  return txb.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [a2b ? coinTypeB : coinTypeA],
    arguments: [a2b ? balanceB : balanceA]
  })
}
