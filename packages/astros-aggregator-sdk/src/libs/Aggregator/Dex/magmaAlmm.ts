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
  const typeArguments = [coinTypeA, coinTypeB]
  const args = [
    txb.object(pair),
    txb.object(AggregatorConfig.magmaAlmmFactory),
    txb.object(AggregatorConfig.magmaConfigId),
    coinA,
    coinB,
    amount,
    txb.pure.u64(minAmountOut),
    txb.pure.bool(a2b),
    txb.pure.address(userAddress),
    txb.object(AggregatorConfig.clockAddress)
  ]

  const [coinABalance, coinBBalance] = txb.moveCall({
    target: `${AggregatorConfig.magmaAlmmPublishedAt}::almm_pair::swap`,
    typeArguments,
    arguments: args
  })

  const coinAOut = txb.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [coinABalance],
    typeArguments: [coinTypeA]
  })

  const coinBOut = txb.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [coinBBalance],
    typeArguments: [coinTypeB]
  })

  return {
    coinAOut,
    coinBOut
  }
}
