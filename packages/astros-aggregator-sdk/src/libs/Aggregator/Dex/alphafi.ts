import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * stSUI（AlphaFi 质押）：直接调执行包 v2 的 liquid_staking::mint / redeem，整枚输入币进入调用。
 * a2b = SUI→stSUI（mint），b2a = stSUI→SUI（redeem）。
 */
export async function makeAlphafiPTB(txb: Transaction, pathTempCoin: any, a2b: boolean) {
  const info = txb.object(AggregatorConfig.alphafiLiquidStakingInfo)
  const system = txb.object('0x5')
  if (a2b) {
    const [out] = txb.moveCall({
      target: `${AggregatorConfig.alphafiPackageId}::liquid_staking::mint`,
      typeArguments: [AggregatorConfig.stSuiCoinType],
      arguments: [info, system, pathTempCoin]
    })
    return out
  }
  const [out] = txb.moveCall({
    target: `${AggregatorConfig.alphafiPackageId}::liquid_staking::redeem`,
    typeArguments: [AggregatorConfig.stSuiCoinType],
    arguments: [info, pathTempCoin, system]
  })
  return out
}
