import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

export async function makeAftermathPTB(
  txb: Transaction,
  poolId: string,
  coinA: any,
  amountOut: any,
  a2b: boolean,
  typeArguments: any
) {
  const args = [
    txb.object(poolId),
    txb.object(AggregatorConfig.aftermathPoolRegistry),
    txb.object(AggregatorConfig.aftermathFeeVault),
    txb.object(AggregatorConfig.aftermathTreasury),
    txb.object(AggregatorConfig.aftermathInsuranceFund),
    txb.object(AggregatorConfig.aftermathReferralVault),
    coinA,
    txb.pure.u64(amountOut),
    // allowable slippage 80%: v5 swap_exact_in turns it into min_out = amountLimit * (1 - 0.8)
    // (amountLimit = 90% of the quoted hop output) and calls swap_exact_in_direct
    txb.pure.u64('800000000000000000')
  ]

  const res = txb.moveCall({
    target: `${AggregatorConfig.aftermathPackageId}::swap::swap_exact_in`,
    typeArguments: typeArguments,
    arguments: args
  })

  return res
}
