/**
 * Vault Type Definitions
 *
 * Types for the NAVI Vault protocol: static configuration (package ids, vault and
 * market object ids) and live on-chain layout (market balances, reward rules, fees).
 *
 * ## Units
 *
 * Raw on-chain integers are `bigint` throughout. Their scales differ per field and are
 * NOT interchangeable:
 *
 * | Quantity                                            | Scale                        |
 * | --------------------------------------------------- | ---------------------------- |
 * | amounts (`deposit`, `withdraw`, `currentBalance`, …) | token native decimals        |
 * | `MarketLayout.loss`                                  | always 9 decimals            |
 * | `managementFee`, `performanceFee`, `penalty`         | WAD (1e18 = 100%)            |
 * | `vaultRewardIndex`, `rewardRate`                     | RAY (1e27), rate is per ms   |
 * | `lastSyncAtMs`, `lastHarvestAtMs`                    | milliseconds                 |
 * | `lastUpdateTimestamp`, timelock timestamps           | seconds                      |
 *
 * @module VaultTypes
 */

import type { Transaction } from '@mysten/sui/transactions'
import type { CacheOption, EnvOption, ServiceOption, SuiClientOption } from '@naviprotocol/lending'

/**
 * Package identifiers for the navi_vault contract.
 *
 * `packageId` and `typePackageId` are NOT interchangeable and using one where the other
 * belongs fails silently in both directions — see the field docs.
 */
export type VaultPackageConfig = {
  /**
   * LATEST published navi_vault package. The `target` of every moveCall.
   *
   * Changes on every contract upgrade. Calling a superseded package runs superseded code
   * until the vault's dependencies move underneath it, then aborts 1400.
   */
  packageId: string
  /**
   * ORIGINAL navi_vault package. Used for every type string — owned-object filters,
   * event filters, `objectType` matching. Fixed for the lifetime of the deployment.
   *
   * A Sui upgrade never changes type identity. Using `packageId` here matches zero
   * objects and reports no error.
   */
  typePackageId: string
  /**
   * Contract version {@link packageId} expects vault objects to carry.
   *
   * The contract gates every entrypoint on `vault.version == this_version()`, so a vault
   * that has not been migrated after a package upgrade aborts `E_INCORRECT_VERSION`
   * (10036) on every call. Checking it before building turns a paid, failed transaction
   * into a build-time error.
   *
   * Omit to skip the check — appropriate only when the configuration cannot be kept in
   * step with the deployed package.
   */
  expectedVaultVersion?: number
}

/** Shared objects required by vault transactions but not discoverable from vault state. */
export type VaultSharedObjects = {
  /** Always `0x6`. */
  clock: string
  /** NAVI PriceOracle. Required by `withdraw` and `deallocate` only. */
  priceOracle: string
  /** NAVI incentive_v2. Global, shared by every market. */
  incentiveV2: string
  /** Always `0x5`. */
  suiSystemState: string
}

/**
 * A NAVI lending market registered on a vault, as configured.
 *
 * The live counterpart is {@link MarketLayout}, which additionally carries the balance
 * snapshot and status. Never build a transaction from this type alone — market
 * membership can change on chain (see {@link VaultLayout}).
 */
export type VaultMarketConfig = {
  /** Human-readable market name, e.g. `main`, `vsui-sui`. Cosmetic only. */
  name: string
  /** `Pool<CoinType>` object id. Identifies the market. */
  pool: string
  /** `Storage` object id of the NAVI lending instance this market belongs to. */
  storage: string
  /** `incentive_v3` object id for this market. */
  incentiveV3: string
  /** Reserve index within `storage`. Distinct markets may reuse the same index. */
  assetId: number
  /**
   * Whether this is the vault's deposit routing target. Not always the market named
   * `main` — read {@link VaultLayout.defaultMarket} at runtime rather than trusting this.
   */
  isDefault: boolean
}

/** A reward rule registered on a vault, as configured. */
export type VaultRewardRuleConfig = {
  /** Stable index into the contract's append-only `reward_rules` vector. */
  index: number
  /** Pool address the rule is attached to. Zero address for vault-native rules. */
  naviPoolId: string
  /** `incentive_v3` rule id. Zero address for vault-native rules. */
  incentiveRuleId: string
  /** Fully qualified reward coin type. */
  rewardCoinType: string
  /** Vault-native rules are settled internally and are never harvested from a market. */
  isVaultNative: boolean
  /** Inactive rules are skipped by `collect_reward` but retain claimable history. */
  isActive: boolean
  /** True when this rule must be harvested in the same block as deposit/withdraw. */
  mustCollectBeforeWithdraw: boolean
  /** `RewardFund<RewardCoinType>` object id. Null for vault-native or inactive rules. */
  rewardFund: string | null
  /** `Storage` of the market this rule harvests from. Null for vault-native rules. */
  storage: string | null
  /** `incentive_v3` of the market this rule harvests from. Null for vault-native rules. */
  incentiveV3: string | null
}

/**
 * A single vault, as configured.
 *
 * Fields that an admin or curator can change without a redeploy — pause state, caps,
 * fees, penalties, market membership — are deliberately absent. Read them at runtime
 * via {@link VaultLayout}.
 */
export type VaultDescriptor = {
  /** Stable key, e.g. `SUI`, `USDC_PRIME`. */
  key: string
  /** Display name, e.g. `SUI High Yield`. */
  displayName: string
  /** Shared `Vault<CoinType>` object id. The only thing that identifies a vault. */
  vault: string
  /** Shared `Timelocks<CoinType>` object id. Only needed to read governance proposals. */
  timelocks: string
  /** Fully qualified underlying coin type. */
  coinType: string
  /** Native decimals of {@link coinType}. */
  decimals: number
  /** Markets registered at configuration time. Verify against chain before building. */
  markets: VaultMarketConfig[]
  /** Reward rules registered at configuration time. Verify against chain before building. */
  rewardRules: VaultRewardRuleConfig[]
}

/** Complete vault configuration. */
export type VaultConfig = {
  package: VaultPackageConfig
  sharedObjects: VaultSharedObjects
  vaults: VaultDescriptor[]
}

/** Market status discriminant as stored on chain. */
export enum MarketStatus {
  /** Accepts deposits, allocations and withdrawals. */
  Active = 0,
  /**
   * No new inflows, but still counted in AUM and still withdrawable — and therefore
   * still required to be synchronized before deposit/withdraw.
   */
  Disabled = 1
}

/** Live market state read from the vault object. */
export type MarketLayout = {
  /** `Pool<CoinType>` object id. */
  poolId: string
  /** Deposit cap in native decimals. `0n` means unlimited. */
  cap: bigint
  /** Withdrawal penalty, WAD-scaled. Applies only to non-default markets, capped at 30%. */
  penalty: bigint
  /** Admin-assigned bad debt. Always 9 decimals, regardless of the token's decimals. */
  loss: bigint
  status: MarketStatus
  /** Milliseconds. `0n` means never synchronized. */
  lastSyncAtMs: bigint
  storageId: string
  assetId: number
  incentiveV3Id: string
  incentiveV2Id: string
  /** Cached position in native decimals, as of {@link lastSyncAtMs}. Stale between syncs. */
  currentBalance: bigint
}

/** Live reward rule state read from the vault object. */
export type RewardRuleLayout = {
  /** Index into the contract's append-only rule vector. Stable for the vault's lifetime. */
  index: number
  naviPoolId: string
  rewardCoinType: string
  incentiveRuleId: string
  /** RAY-scaled (1e27). */
  vaultRewardIndex: bigint
  /** Milliseconds. */
  lastHarvestAtMs: bigint
  isVaultNative: boolean
  /** RAY-scaled per millisecond. `0n` for market rules. */
  rewardRate: bigint
  isActive: boolean
  /** Vault-native budget cap. `0n` for market rules. */
  totalRewardDeposited: bigint
  /** Vault-native amount already distributed via index growth. `0n` for market rules. */
  totalRewardDistributed: bigint
}

/**
 * Live vault state.
 *
 * Must be read at transaction-construction time and must NOT be cached across
 * transactions: `add_market` initializes a market with `lastSyncAtMs = 0n`, and
 * `set_loss` resets an existing market's, either of which makes a transaction built
 * from a stale layout abort with `E_MARKET_NOT_READ`.
 */
export type VaultLayout = {
  /** Every registered market, Active and Disabled alike. All require synchronization. */
  markets: MarketLayout[]
  rules: RewardRuleLayout[]
  /** Deposit routing target. Zero address means deposits accumulate in the idle balance. */
  defaultMarket: string
  paused: boolean
  /** Contract version of the vault object. Must match the deployed package. */
  version: bigint
  /** Vault-level deposit cap in native decimals. `0n` means unlimited. */
  vaultCap: bigint
  /** WAD-scaled annual rate, capped at 20%. */
  managementFee: bigint
  /** WAD-scaled share of profit, capped at 40%. */
  performanceFee: bigint
  /** Assets held in the vault but not deployed to any market, in native decimals. */
  idleBalance: bigint
  /** Total shares outstanding, including accrued but unclaimed fee shares. */
  totalShares: bigint
}

/** Rules that must be harvested in the same block as a deposit or withdrawal. */
export type HarvestableRule = RewardRuleLayout & {
  /** Resolved `RewardFund<RewardCoinType>` object id. */
  rewardFund: string
  /** `Storage` of the market this rule harvests from. */
  storageId: string
  /** `incentive_v3` of the market this rule harvests from. */
  incentiveV3Id: string
}

/** A depositor's position object. */
export type VaultReceipt = {
  /** Receipt object id. */
  objectId: string
  /**
   * The vault this receipt belongs to. `Receipt` is not generic — one type covers every
   * vault — so this field is the only way to attribute a receipt.
   */
  vaultAddress: string
}

/** Synchronized snapshot of a vault's pricing state. */
export type VaultQuote = {
  /** Assets under management in native decimals, as of a freshly synchronized read. */
  totalAssets: bigint
  totalShares: bigint
  idleBalance: bigint
  /** Per-market synchronized balances, keyed by pool id. */
  marketBalances: Record<string, bigint>
  /**
   * Remaining vault-level deposit headroom in native decimals, or `null` when uncapped.
   *
   * This is the vault's own bound only. The effective headroom is the minimum of this,
   * the target market's cap, and NAVI's reserve supply ceiling — the last of which is
   * shared with every other participant in that reserve and cannot be derived from
   * vault state.
   */
  depositHeadroom: bigint | null
}

/** A holder's position, valued against a synchronized snapshot. */
export type VaultPosition = {
  receiptId: string
  shares: bigint
  /** Value in native decimals. */
  balance: bigint
}

/** Identifies a vault: its object id, its config key, or a full descriptor. */
export type VaultIdentifier = string | VaultDescriptor

/** Selects which vault an operation targets. */
export type VaultOption = {
  vault: VaultIdentifier
}

/**
 * Supplies a pre-read layout, skipping the round trip that reads it.
 *
 * Only pass a layout obtained during the construction of the current transaction.
 */
export type LayoutOption = {
  layout: VaultLayout
}

/** Overrides the bundled configuration snapshot. */
export type VaultConfigOption = {
  config: VaultConfig
}

/** Options accepted by read paths. */
export type VaultReadOptions = Partial<
  EnvOption & CacheOption & SuiClientOption & ServiceOption & VaultConfigOption
>

/** Options accepted by transaction builders. */
export type VaultBuildOptions = Partial<
  EnvOption & SuiClientOption & ServiceOption & VaultConfigOption & LayoutOption
>

/** Arguments for building a deposit. */
export type DepositArgs = {
  vault: VaultIdentifier
  /** Amount in native decimals. The deposit coin is split to exactly this value. */
  amount: bigint
  /** Depositor address. Receives the receipt. */
  sender: string
  /**
   * Which position to credit.
   *
   * - omitted — resolve automatically: reuse the sender's receipt when they hold exactly
   *   one, mint a new one when they hold none. Holding several is ambiguous and raises an
   *   error listing them, because a receipt *is* a position and guessing which to top up
   *   is what leaves stray empty ones behind. Costs one extra read (~60ms).
   * - a receipt object id — credit that position. No lookup.
   * - `'new'` — open a fresh position. No lookup. A holder may hold any number of
   *   receipts against one vault; they are independent and never merge.
   */
  position?: string | 'new'
  /**
   * Coin to draw the deposit from. Defaults to `tx.gas` for SUI vaults, which is only
   * correct when the underlying asset is SUI.
   */
  coin?: Parameters<Transaction['splitCoins']>[0]
}

/** Arguments for building a withdrawal. */
export type WithdrawArgs = {
  vault: VaultIdentifier
  receiptId: string
  /** Amount in native decimals. Clamped to the holder's maximum when `fromDefault`. */
  amount: bigint
  sender: string
  /**
   * Upper bound on shares burned. `0n` disables the check entirely — it means
   * "no limit", not "no shares". Derive it from a simulated withdrawal.
   */
  maxShares: bigint
  /**
   * When true, `pool` must be the default market and no penalty applies. When false,
   * any registered market may be drawn from and that market's penalty applies to the
   * portion actually taken from it.
   */
  fromDefault?: boolean
  /** Market to draw the shortfall from. Defaults to the vault's default market. */
  poolId?: string
}

/** Arguments for building a reward claim. */
export type ClaimRewardArgs = {
  vault: VaultIdentifier
  receiptId: string
  /** Reward coin type to claim. One call settles every rule paying this coin. */
  rewardCoinType: string
  sender: string
}
