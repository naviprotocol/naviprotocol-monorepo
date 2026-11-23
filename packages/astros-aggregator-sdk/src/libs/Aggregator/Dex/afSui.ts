import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * afSUI（Aftermath 质押）：直接调 LSD v2。
 * a2b = SUI→afSUI：staked_sui_vault::request_stake，验证人固定用 Aftermath 自己的（手续费 0）
 * b2a = afSUI→SUI：staked_sui_vault::request_unstake_atomic（从即时赎回准备金付款）
 */
export async function makeAfSuiPTB(txb: Transaction, pathTempCoin: any, a2b: boolean) {
  const c = AggregatorConfig
  if (a2b) {
    const [out] = txb.moveCall({
      target: `${c.afSuiPackageId}::staked_sui_vault::request_stake`,
      typeArguments: [],
      arguments: [
        txb.object(c.afSuiVault),
        txb.object(c.afSuiSafe),
        txb.object('0x5'),
        txb.object(c.afSuiReferralVault),
        pathTempCoin,
        txb.pure.address(c.afSuiValidator)
      ]
    })
    return out
  }
  const [out] = txb.moveCall({
    target: `${c.afSuiPackageId}::staked_sui_vault::request_unstake_atomic`,
    typeArguments: [],
    arguments: [
      txb.object(c.afSuiVault),
      txb.object(c.afSuiSafe),
      txb.object(c.afSuiReferralVault),
      txb.object(c.afSuiTreasury),
      pathTempCoin
    ]
  })
  return out
}
