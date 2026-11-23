import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * haWAL（Haedal 的 WAL 质押）：直接调 Haedal v6 的 walstaking::request_stake_coin，validator 传 0x0（由 Haedal 自选）。
 * 只支持 WAL→haWAL；后端不会返回 haWAL→WAL 的路由。
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
