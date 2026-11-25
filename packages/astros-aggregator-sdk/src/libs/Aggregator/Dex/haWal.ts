import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * haWAL (Haedal WAL liquid staking): calls walstaking::request_stake_coin on Haedal v6 with validator 0x0
 * (Haedal picks one). WAL -> haWAL only; the backend never returns haWAL -> WAL routes.
 */
export async function makeHaWalPTB(txb: Transaction, pathTempCoin: any, a2b: boolean) {
  if (!a2b) throw new Error('haWAL -> WAL is not supported')
  const [out] = txb.moveCall({
    target: `${AggregatorConfig.haWalPackageId}::walstaking::request_stake_coin`,
    typeArguments: [],
    arguments: [
      txb.object(AggregatorConfig.walrusStaking),
      txb.object(AggregatorConfig.haWalStaking),
      pathTempCoin,
      txb.pure.id('0x0000000000000000000000000000000000000000000000000000000000000000')
    ]
  })
  return out
}
