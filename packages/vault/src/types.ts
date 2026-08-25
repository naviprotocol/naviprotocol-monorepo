/**
 * Caching configuration options
 */
export type CacheOption = {
  /** Whether to disable caching for this operation */
  disableCache: boolean
  /** Cache expiration time in milliseconds */
  cacheTime: number
}

export type EnvOption = {
  env: 'dev' | 'prod'
}

export type VaultSource = 'navi' | 'volo'

export type VaultProtocol = 'navi' | 'volo' | 'astros'

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

export type VaultLockup = {
  startAt: string
  endAt: string
}

type NAVIVaultCustomConfig = {
  package: string
}

type VoloVaultCustomConfig = {
  package: string
  rewardManager: string
  statusRecord: string
}

export type Vault = {
  /** Sui object id. Global primary key. */
  id: string
  /** Which upstream this row came from. */
  source: VaultSource
  /** Strategy provider: navi | volo | astros. NOT a source discriminator. */
  protocol: VaultProtocol
  name: string
  riskLevel: string | null
  status: string | null

  apy: VaultApy

  assets: {
    baseCoin: {
      coinType: string
      decimals: number
      symbol: string
    }
  }

  totalStaked: number | null
  totalStakedUsd: number | null
  totalShares: string | null
  exchangeRate: number | null
  coinPrice: number | null
  minInvestment: number | null
  stakeCapAmount: number | null

  lockup: VaultLockup | null

  navi?: NAVIVaultCustomConfig
  volo?: VoloVaultCustomConfig
}

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

  yieldLifetimeAmount: number | null
  yieldLifetimeUsd: number | null
}

export type VaultIdentifier = string | Vault

export type PendingRequest = {
  txId: string
  vaultId: string
  type: 'deposit' | 'withdraw'
  amount: string
  amountUsd: string
  shares: string
  receiptId: string
  requestId: string
  executeTime: string
}
