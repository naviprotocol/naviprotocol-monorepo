import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

export async function makeFLOWXPTB(
  txb: Transaction,
  fee: string,
  coinA: any,
  a2b: boolean,
  minAmountOut: any,
  deadline: string | number,
  typeArguments: string[]
) {
  const coinTypeA = a2b ? typeArguments[0] : typeArguments[1]
  const coinTypeB = a2b ? typeArguments[1] : typeArguments[0]

  const sqrtPriceLimit = BigInt(a2b ? '4295048017' : '79226673515401279992447579054')

  const coinResult = txb.moveCall({
    target: `${AggregatorConfig.flowxPackageId}::swap_router::swap_exact_input`,
    arguments: [
      txb.object(AggregatorConfig.flowxPoolRegistry),
      txb.pure.u64(fee),
      coinA,
      txb.pure.u64(minAmountOut),
      txb.pure.u128(sqrtPriceLimit),
      txb.pure.u64(deadline),
      txb.object(AggregatorConfig.flowxVersioned),
      txb.object(AggregatorConfig.clockAddress)
    ],
    typeArguments: [coinTypeA, coinTypeB]
  })

  return coinResult
}
