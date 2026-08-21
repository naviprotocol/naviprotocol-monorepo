import type { VaultProtocol } from '../../types'

/**
 * The shared `Clock`. A Sui system object created at genesis, so the id is the same on
 * every network and for every deployment.
 */
export const CLOCK_OBJECT_ID = '0x6'

/**
 * `SuiSystemState`. Also a genesis object, so also fixed everywhere. NAVI Lending's
 * `withdraw` takes it because the market may hold a staked asset.
 */
export const SUI_SYSTEM_STATE_OBJECT_ID = '0x5'

/**
 * Original published package id per protocol — what every type string must use.
 *
 * A Sui upgrade publishes a new id but never changes type identity, so filtering owned
 * objects by `contractConfig.package` matches nothing while reporting no error. These are
 * immutable for the lifetime of a deployment, hence constants rather than configuration.
 * Keyed by the protocol discriminant, so `navi-lending` here is the NAVI Vault contract.
 */
export const ORIGINAL_PACKAGE_ID: Record<VaultProtocol, string> = {
  'navi-lending': '0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c',
  'volo-vault': '0xcd86f77503a755c48fe6c87e1b8e9a137ec0c1bf37aac8878b6083262b27fefa'
}
