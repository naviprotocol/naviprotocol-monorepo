import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

export async function makeMAGMAALMMPTB(
  txb: Transaction,
  coinTypeA: string,
  coinTypeB: string,
  coinA: any,
  coinB: any,
  pair: string,
  amount: any,
  minAmountOut: any,
  a2b: boolean,
  userAddress: string
) {
  const almmConfig = {
    factory: '',
    rewarder_global_vault: ''
  }
  const typeArguments = [coinTypeA, coinTypeB]
  const args = [
    txb.object(almmConfig.factory),
    txb.object(pair),
    txb.object(AggregatorConfig.magmaConfigId),
    coinA,
    coinB,
    amount,
    txb.pure.u64(minAmountOut),
    txb.pure.bool(a2b),
    txb.pure.address(userAddress),
    txb.object(AggregatorConfig.clockAddress)
  ]

  txb.moveCall({
    target: `${AggregatorConfig.magmaIntegratePublishedAt}::almm_script::swap`,
    typeArguments,
    arguments: args
  })
  return txb
}
