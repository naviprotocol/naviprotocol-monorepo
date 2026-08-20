import type { VaultApp, VaultEnv, VaultProtocol } from '../types'

export interface VaultAsset {
  coinType: string
  decimals: number
}

/**
 * Assets a vault deals in.
 *
 * `base` is the principal coin the vault accounts in. `deposits` lists every coin type a
 * deposit may be funded with, which is a superset of `base`: Volo vaults accept a
 * configured set of non-principal coins and swap them into the principal before
 * depositing, while NAVI Lending vaults accept only `base` because the contract's
 * `deposit` is generic over the vault's own `CoinType`.
 */
export interface VaultAssets {
  base: VaultAsset
  deposits: VaultAsset[]
}

export interface BaseVaultContractConfig {
  env: VaultEnv
  schemaVersion: number
  /** Latest published package. The `target` of every moveCall; changes on every upgrade. */
  package: string
  /**
   * Original published package. Used for every type string — owned-object filters, event
   * filters, `objectType` matching. A Sui upgrade never changes type identity, and using
   * `package` here matches zero objects while reporting no error.
   */
  initialPackageId: string
  clockObjectId: string
  minSdkVersion?: string
}

export interface NAVILendingMarket {
  code: string
  poolObjectId: string
  storageObjectId: string
  assetId: number
  incentiveV2ObjectId: string
  incentiveV3ObjectId: string
}

/**
 * `market` rules are harvested from NAVI's incentive before a deposit or withdrawal.
 * `vault-native` rules are settled inside the vault from a per-millisecond rate and are
 * never harvested.
 */
export type NAVILendingRewardRuleType = 'market' | 'vault-native'

/**
 * A reward rule as configured.
 *
 * Shape follows the NAVI vault backend's own static config. The fields below `active` are
 * optional because `vault-native` rules have no market, no incentive rule and no fund;
 * for `market` rules they are all required to build `collect_reward`, whose signature is
 * `(vault, clock, storage, incentive_v3, reward_fund, rule_index)`.
 */
export interface NAVILendingRewardRule {
  /** Index into the contract's append-only rule vector. Stable for the vault's lifetime. */
  ruleIndex: number
  type: NAVILendingRewardRuleType
  /** Inactive rules are not harvested and not counted, but remain claimable. */
  active: boolean
  rewardCoinType: string
  /** Pool address of the market this rule harvests from. */
  naviPoolId?: string
  incentiveRuleId?: string
  /**
   * `RewardFund<RewardCoinType>` object. It belongs to NAVI's `incentive_v3` and is not
   * discoverable from vault state, so it has to be configured. `@naviprotocol/lending`
   * also publishes it via `getConfig().rewardFunds`, keyed by reward coin type.
   */
  rewardFundObjectId?: string
  storageObjectId?: string
  incentiveV3ObjectId?: string
}

export interface NAVILendingContractConfig extends BaseVaultContractConfig {
  naviLending: {
    timelockObjectId: string
    oraclePackageId: string
    oracleConfigObjectId: string
    priceOracleObjectId: string
    suiSystemStateObjectId?: string
    /**
     * Every market registered on the vault. The contract asserts that all of them were
     * synchronized in the same transaction as a deposit or withdrawal, so an incomplete
     * list aborts `E_MARKET_NOT_READ`.
     */
    markets: NAVILendingMarket[]
    /** The only market a deposit can be routed to, and the only penalty-free withdrawal source. */
    defaultMarketCode: string
    rewardRules: NAVILendingRewardRule[]
  }
}

export interface ReceiptBasedVaultContractConfig {
  vaultCode: string
  receiptParentObjectId?: string
  rewardManagerObjectId?: string
}

export interface VoloVaultContractConfig extends BaseVaultContractConfig {
  volo: ReceiptBasedVaultContractConfig & {
    configObjectId: string
    stakingObjectId: string
    metadataObjectId?: string
  }
}

export interface VaultContractConfigMap {
  'navi-lending': NAVILendingContractConfig
  'volo-vault': VoloVaultContractConfig
}

/**
 * How a vault settles user requests.
 *
 * `instant` mints or redeems shares inside the user's own transaction. `eventual` records
 * a request that an operator fulfils later, which is why cancellation exists at all.
 */
export type VaultOperatorMode = 'instant' | 'eventual'

export interface BaseVault<P extends VaultProtocol, C extends VaultContractConfigMap[P]> {
  id: string
  app: VaultApp
  protocol: P
  contractConfig: C
  assets: VaultAssets
  operatorMode: VaultOperatorMode
}

export type NAVILendingVault = BaseVault<'navi-lending', NAVILendingContractConfig>
export type VoloVault = BaseVault<'volo-vault', VoloVaultContractConfig>

/**
 * Discriminated on `protocol`: narrowing on it also narrows `contractConfig`, so callers
 * reach protocol fields without a cast.
 */
export type Vault = NAVILendingVault | VoloVault

export type VaultIdentifier = string | Vault

export interface VaultListApiResponse {
  data: Vault[]
}

export interface VaultDetailApiResponse {
  data: Vault | null
}

export interface GetVaultOptions {
  disableCache?: boolean
  cacheTime?: number
}

export interface GetVaultsOptions extends GetVaultOptions {
  app: VaultApp[]
}

export interface VaultsModule {
  getVault(vaultId: string, options?: GetVaultOptions): Promise<Vault | null>
  getVaults(options?: GetVaultsOptions): Promise<Vault[]>
}
