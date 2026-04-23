/**
 * Core market identity for lending admin config selection.
 */
export type MarketConfig = {
  id: number
  key: string
  name: string
}

/**
 * Supported market selector input.
 */
export type MarketIdentity = number | string | MarketConfig

/**
 * Environment selection for config fetches.
 */
export type EnvOption = {
  env: 'dev' | 'prod' | 'test'
}

/**
 * Cache control for remote config fetches.
 */
export type CacheOption = {
  disableCache?: boolean
  cacheTime?: number
}

/**
 * Optional market selector for config fetches.
 */
export type MarketOption = {
  market?: MarketIdentity
}

/**
 * Oracle feed metadata returned by open-api.
 */
export type OraclePriceFeed = {
  oracleId: number
  assetId: number
  coinType: string
  feedId: string
  pythPriceFeedId: string
  pythPriceInfoObject: string
  priceDecimal: number
  supraPairId: number
}

/**
 * Lending admin object ids and capability ids used by admin builders.
 */
export type LendingAdminConfig = {
  package: string
  storage: string
  incentiveV3: string
  flashloanConfig: string
  poolAdminCap: string
  storageAdminCap: string
  ownerCap: string
  incentiveOwnerCap: string
}

/**
 * Oracle admin config used by admin builders.
 */
export type OracleAdminConfig = {
  packageId: string
  priceOracle: string
  oracleAdminCap: string
  oracleFeederCap: string
  oracleConfig: string
  pythStateId: string
  wormholeStateId: string
  supraOracleHolder: string
  sender: string
  gasObject: string
  switchboardAggregator: string
  feeds: OraclePriceFeed[]
}

/**
 * Reserve metadata needed for asset and pool resolution.
 */
export type ReserveMetadata = {
  assetId: number
  coinType: string
  decimals: number
  symbol: string
  poolId: number
  pool: string
  market: string
}

/**
 * Public admin config returned by `getAdminConfig`.
 */
export type AdminConfig = {
  lending: LendingAdminConfig
  oracle: OracleAdminConfig
  reserveMetadata: ReserveMetadata[]
  market: MarketConfig
  version: number
}

/**
 * Raw `/api/navi/config` response fields consumed by this package.
 */
export type AdminConfigApiPayload = {
  package: string
  storage: string
  incentiveV3: string
  flashloanConfig: string
  oracle: OracleAdminConfig
  lendingAdmin?: LendingAdminConfig
  reserveMetadata?: ReserveMetadata[]
  version: number
}

export type AdminConfigApiResponse = {
  data: AdminConfigApiPayload
}

/**
 * Explicit rate input for ray-backed admin fields.
 */
export type RayRateInput = {
  value: string
  unit: 'percent' | 'ratio' | 'ray'
}

/**
 * Explicit amount input for coin-native values.
 */
export type AmountInput = {
  value: string
  unit: 'token' | 'atomic'
}

/**
 * Explicit price input for decimal or atomic price values.
 */
export type PriceInput = {
  value: string
  unit: 'decimal' | 'atomic'
  decimals?: number
}
