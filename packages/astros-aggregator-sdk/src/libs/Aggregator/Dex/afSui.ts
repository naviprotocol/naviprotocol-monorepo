import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * afSUI (Aftermath liquid staking): calls the LSD package v2 directly.
 * a2b = SUI -> afSUI: staked_sui_vault::request_stake with Aftermath's own validator (fee 0).
 * b2a = afSUI -> SUI: staked_sui_vault::request_unstake_atomic (paid from the instant-redeem reserve).
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
