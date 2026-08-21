import type { VaultApp, VaultProtocol } from '../types'

export interface VaultAsset {
  coinType: string
}

/**
 * Assets a vault deals in.
 *
 * `base` is the principal coin the vault accounts in, and the only coin a deposit may be
 * funded with. Depositing something else means swapping to `base` first, which the caller
 * composes into the same transaction.
 *
 * No `decimals`: amounts cross the PTB builders in the coin's smallest unit, so nothing
 * here converts, and the caller that formats balances already holds the coin's metadata.
 */
export interface VaultAssets {
  base: VaultAsset
}

export interface BaseVaultContractConfig {
  /**
   * Latest published package — the `target` of every moveCall.
   *
   * Changes on every upgrade, and while it is stale everything fails: both contracts check
   * the vault object's version against a constant compiled into the package, with strict
   * equality, so calling the previous package after a migration aborts.
   */
  package: string
}

export interface NAVILendingMarket {
  /** NAVI's market key, as served by `/api/navi/markets` — `main`, `sui-eco`, `vsui-sui`. */
  code: string
  /**
   * The only market a deposit can be routed to, and the only penalty-free withdrawal
   * source. Exactly one market carries it.
   *
   * Governance can move it. Until the configuration catches up, `deposit` and any
   * withdrawal larger than the vault's idle balance abort `E_DEFAULT_MARKET_MISMATCH`
   * (10022) — the contract asserts the pool it is handed is the current default.
   */
  isDefault: boolean
  poolObjectId: string
  storageObjectId: string
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
 * The two fields below `rewardCoinType` are optional because `vault-native` rules have no
 * market and no fund; for `market` rules both are required to build `collect_reward`,
 * whose signature is `(vault, clock, storage, incentive_v3, reward_fund, rule_index)`.
 * Its `storage` and `incentive_v3` come from the market {@link naviPoolId} names — the
 * contract asserts exactly that, so they are not configured separately.
 */
export interface NAVILendingRewardRule {
  /**
   * Index into the contract's append-only rule vector. Stable for the vault's lifetime.
   *
   * Explicit rather than the array position: `collect_reward` addresses rules by index, and
   * harvesting the wrong one is a silent no-op that later aborts `E_REWARDS_NOT_COLLECTED`.
   */
  ruleIndex: number
  type: NAVILendingRewardRuleType
  /** Inactive rules are not harvested and not counted, but remain claimable. */
  active: boolean
  rewardCoinType: string
  /** Pool address of the market this rule harvests from, and the key into `markets`. */
  naviPoolId?: string
  /**
   * `RewardFund<RewardCoinType>` object. It belongs to NAVI's `incentive_v3`, is not
   * discoverable from vault state, and is per market — the same reward coin has a
   * different fund in each one — so it has to be configured per rule.
   */
  rewardFundObjectId?: string
}

export interface NAVILendingContractConfig extends BaseVaultContractConfig {
  naviLending: {
    /**
     * Every market registered on the vault. The contract asserts that all of them were
     * synchronized in the same transaction as a deposit or withdrawal, so an incomplete
     * list aborts `E_MARKET_NOT_READ`.
     */
    markets: NAVILendingMarket[]
    rewardRules: NAVILendingRewardRule[]
  }
}

export interface ReceiptBasedVaultContractConfig {
  /**
   * The vault's `receipts` Table, parent of the per-receipt dynamic fields holding settled
   * shares. Optional because it is only read to choose between several receipts; a holder
   * with one needs no lookup.
   */
  receiptParentObjectId?: string
  /**
   * `RewardManager` for this vault. Required rather than optional: `user_entry::deposit`
   * takes it as its second argument, so it is not only a rewards concern.
   */
  rewardManagerObjectId: string
}

export interface VoloVaultContractConfig extends BaseVaultContractConfig {
  volo: ReceiptBasedVaultContractConfig
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
