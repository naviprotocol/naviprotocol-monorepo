import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'
import { vSuiConfig } from '../../../address'

export async function makeVSUIPTB(txb: Transaction, pathTempCoin: any, a2b: boolean) {
  let coinB

  if (a2b) {
    ;[coinB] = txb.moveCall({
      target: `${AggregatorConfig.vSuiPackageId}::stake_pool::stake`,
      typeArguments: [],
      arguments: [
        txb.object(vSuiConfig.pool),
        txb.object(vSuiConfig.metadata),
        txb.object(vSuiConfig.wrapper),
        pathTempCoin
      ]
    })
  } else {
    ;[coinB] = txb.moveCall({
      target: `${AggregatorConfig.vSuiPackageId}::stake_pool::unstake`,
      arguments: [
        txb.object(vSuiConfig.pool),
        txb.object(vSuiConfig.metadata),
        txb.object(vSuiConfig.wrapper),
        pathTempCoin
      ],
      typeArguments: []
    })
  }

  return coinB
}
