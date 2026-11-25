import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * stSUI (AlphaFi liquid staking): calls liquid_staking::mint / redeem on execution package v2
 * with the whole input coin. a2b = SUI -> stSUI (mint), b2a = stSUI -> SUI (redeem).
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
