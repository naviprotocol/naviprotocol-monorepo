/**
 * Caching configuration options
 */
export type CacheOption = {
  /** Whether to disable caching for this operation */
  disableCache: boolean
  /** Cache expiration time in milliseconds */
  cacheTime: number
}

/** Target environment for API/on-chain calls. Currently only production is supported. */
export type EnvOption = {
  env: 'prod'
}

/**
 * Which SDK integration serves a vault (i.e. which `depositPTB`/`withdrawPTB` code path
 * runs). Not the same as {@link VaultProtocol} — an `astros`-protocol vault is still
 * served through the `navi` or `volo` source.
 */
export type VaultSource = 'navi' | 'volo'

/** Strategy provider that actually deploys the vault's capital. NOT a source discriminator. */
export type VaultProtocol = 'navi' | 'volo' | 'astros'

/** Every supported {@link VaultSource}, in no particular order. */
export const VAULT_SOURCES: VaultSource[] = ['navi', 'volo']

/**
 * Yield figures. Every value in this object is a decimal FRACTION
 * (0.0807 == 8.07%), normalized across sources: navi already reports
 * fractions and passes through, volo reports percent and is divided by 100.
 */
export type VaultApy = {
  avg7d: number | null
  avg30d: number | null
  instant: number | null
  target: number | null
}

/** ISO-8601 timestamps bounding a vault's lockup window, when it has one. */
export type VaultLockup = {
  startAt: string
  endAt: string
}

/** Present on `Vault.navi` only for vaults served by the NAVI source. */
type NAVIVaultCustomConfig = {
  /** Published address of the `navi_vault` Move package this vault's on-chain object belongs to. */
  package: string
}

/** Present on `Vault.volo` only for vaults served by the Volo source. */
type VoloVaultCustomConfig = {
  /** Published address of the `volo_vault` Move package this vault's on-chain object belongs to. */
  package: string
  /** Shared `RewardManager` object the vault's deposit/reward calls read. */
  rewardManager: string
  /**
   * Address of the vault-event-recorder PACKAGE whose `vault_deposit_recorder` module the
   * deposit/withdraw builders call to emit off-chain-visible request records. Not an object id.
   */
  statusRecord: string
}

/** A vault as returned by the NAVI open API — the shape `getVaults`/`getVault` resolve to. */
export type Vault = {
  /** Sui object id. Global primary key. */
  id: string
  /** Which upstream this row came from. */
  source: VaultSource
  /** Strategy provider: navi | volo | astros. NOT a source discriminator. */
  protocol: VaultProtocol
  /** Human-readable display name. */
  name: string
  /** Free-form risk classification as reported by the API (e.g. `"low"`, `"medium"`). */
  riskLevel: string | null
  /** Free-form vault status as reported by the API (e.g. `"active"`, `"paused"`). */
  status: string | null

  /** Yield figures; see {@link VaultApy}. */
  apy: VaultApy

  assets: {
    /** The single coin type this vault accepts deposits in and pays out on withdrawal. */
    baseCoin: {
      coinType: string
      decimals: number
      symbol: string
    }
  }

  /** Total principal staked, in the base coin's human-readable units. */
  totalStaked: number | null
  /** Total principal staked, in USD. */
  totalStakedUsd: number | null
  /** Total shares outstanding, as a raw base-unit string (may exceed `Number.MAX_SAFE_INTEGER`). */
  totalShares: string | null
  /** Base coin units per share, i.e. `totalStaked / totalShares` at the API's decimals. */
  exchangeRate: number | null
  /** Base coin's current USD price. */
  coinPrice: number | null
  /** Minimum deposit amount, in the base coin's human-readable units, or `null` if unrestricted. */
  minInvestment: number | null
  /** Vault-wide deposit cap, in the base coin's human-readable units, or `null` if unrestricted. */
  stakeCapAmount: number | null

  /** Deposit lockup window, or `null` when the vault has none. */
  lockup: VaultLockup | null

  /** NAVI on-chain config. Present only when `source === 'navi'`. */
  navi?: NAVIVaultCustomConfig
  /** Volo on-chain config. Present only when `source === 'volo'`. */
  volo?: VoloVaultCustomConfig
}

/** An owner's position in a single vault, as returned by the NAVI open API. */
export type VaultPosition = {
  vaultId: string
  /** Which upstream returned this position. */
  source: VaultSource
  /** Strategy provider: navi | volo | astros. Still not a source discriminator. */
  protocol: VaultProtocol
  /** Normalized holder address, echoed back so callers can cross-check. */
  address: string

  /** Raw on-chain shares. Big integer kept as a string, as in StandardVault. */
  shares: string | null

  /** Upstream poolShareTokenBalance: position size denominated in the vault coin. */
  tokenBalance: number | null
  /** Upstream poolShareTokenUsd: position value in USD. */
  tokenUsd: number | null
  /** Upstream coinPrice (navi) / tokenPrice (volo). */
  coinPrice: number | null

  /**
   * Decimal fraction (0.0647 == 6.47%), normalized across sources: navi passes
   * through, volo is divided by 100. Null when the upstream value fell outside
   * the plausible band — a safe failure beats a 100x-wrong yield.
   */
  apr: number | null

  /** Lifetime yield earned, in the base coin's human-readable units. */
  yieldLifetimeAmount: number | null
  /** Lifetime yield earned, in USD. */
  yieldLifetimeUsd: number | null
}

/**
 * A vault to operate on: either its Sui object id, or an already-fetched {@link Vault}
 * object (accepted as-is, skipping the lookup).
 */
export type VaultIdentifier = string | Vault

/**
 * A deposit or withdraw request recorded off-chain by the NAVI open API — the aggregate,
 * API-facing counterpart of `volo.PendingRequest`, which reads the same kind of request
 * directly from a single Volo vault's on-chain request buffer.
 */
export type PendingRequest = {
  /** Transaction digest that created the request. */
  txId: string
  vaultId: string
  type: 'deposit' | 'withdraw'
  /** Requested amount, in the base coin's human-readable units, as a decimal string. */
  amount: string
  /** Requested amount, in USD, as a decimal string. */
  amountUsd: string
  /** Shares involved, as a raw base-unit string. */
  shares: string
  /** Receipt object the request settles into; required by `cancelPendingDepositPTB`/`cancelPendingWithdrawPTB`. */
  receiptId: string
  /** On-chain request id; required by `cancelPendingDepositPTB`/`cancelPendingWithdrawPTB`. */
  requestId: string
  /** ISO-8601 timestamp of when an operator is expected to execute the request. */
  executeTime: string
}
