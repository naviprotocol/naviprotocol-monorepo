import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

export async function makeDeepbookPTB(
  txb: Transaction,
  poolId: string,
  coinA: any,
  amountLimit: any,
  a2b: boolean,
  typeArguments: any
) {
  const func = a2b ? 'swap_exact_base_for_quote_sponsored' : 'swap_exact_quote_for_base_sponsored'

  // sponsored_deep links DeepBook v1, which aborts in pool::load_inner (code 12). A read-only
  // v8 call in the same PTB lifts the transaction's DeepBook linkage to v8, so the sponsored
  // swap below runs v8 code. pool_book_params only aborts when v8 is not an allowed version.
  txb.moveCall({
    target: `${AggregatorConfig.deepbookLinkagePackageId}::pool::pool_book_params`,
    arguments: [txb.object(poolId)],
    typeArguments: typeArguments
  })

  const [baseCoinOut, quoteCoinOut] = txb.moveCall({
    target: `${AggregatorConfig.deepSponsoredPackageId}::sponsored_deep::${func}`,
    arguments: [
      txb.object(AggregatorConfig.deepSponsoredPoolConfig),
      txb.object(poolId),
      coinA,
      txb.pure.u64(amountLimit),
      txb.object(AggregatorConfig.clockAddress)
    ],
    typeArguments: typeArguments
  })

  return { baseCoinOut, quoteCoinOut }
}
