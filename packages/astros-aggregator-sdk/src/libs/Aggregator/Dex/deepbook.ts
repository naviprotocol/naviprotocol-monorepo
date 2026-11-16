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
  const func = a2b ? 'swap_exact_base_for_quote' : 'swap_exact_quote_for_base'

  // Pay the DeepBook taker fee from the input coin: pass a zero DEEP coin, so
  // pool::swap_exact_quantity sets pay_with_deep = false and charges taker fee x 1.25
  // in the input asset. NAVI's sponsored_deep (which paid the fee in DEEP) is retired:
  // its pool was drained and is no longer funded.
  const zeroDeep = txb.moveCall({
    target: '0x2::coin::zero',
    typeArguments: [AggregatorConfig.deepTokenAddress]
  })

  const [baseCoinOut, quoteCoinOut, deepCoinOut] = txb.moveCall({
    target: `${AggregatorConfig.deepbookLinkagePackageId}::pool::${func}`,
    arguments: [
      txb.object(poolId),
      coinA,
      zeroDeep,
      txb.pure.u64(amountLimit),
      txb.object(AggregatorConfig.clockAddress)
    ],
    typeArguments: typeArguments
  })

  // deepCoinOut is always zero when no DEEP is passed in; the caller still has to consume it.
  return { baseCoinOut, quoteCoinOut, deepCoinOut }
}
