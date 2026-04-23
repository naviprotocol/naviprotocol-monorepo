import type {
  AdminConfig,
  AdminConfigApiPayload,
  AdminConfigApiResponse,
  CacheOption,
  EnvOption,
  MarketOption
} from './types'
import { withCache, withSingleton, requestHeaders } from './utils'
import packageJson from '../package.json'
import { DEFAULT_MARKET_IDENTITY, getMarketConfig } from './market'

export const DEFAULT_CACHE_TIME = 1000 * 60 * 5
const DEFAULT_ENV: EnvOption['env'] = 'prod'

type AdminConfigRequestOptions = Partial<EnvOption & CacheOption & MarketOption>
type NormalizedAdminConfigOptions = CacheOption & {
  env: EnvOption['env']
  market: string
}

function assertNonEmptyString(value: string | undefined, fieldName: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Open API response is missing ${fieldName}`)
  }
}

function assertAdminConfigPayload(
  data: AdminConfigApiPayload
): asserts data is AdminConfigApiPayload & {
  lendingAdmin: NonNullable<AdminConfigApiPayload['lendingAdmin']>
  reserveMetadata: NonNullable<AdminConfigApiPayload['reserveMetadata']>
} {
  if (!data.lendingAdmin) {
    throw new Error('Open API response is missing lendingAdmin')
  }

  if (!Array.isArray(data.reserveMetadata)) {
    throw new Error('Open API response is missing reserveMetadata')
  }

  if (!data.oracle) {
    throw new Error('Open API response is missing oracle')
  }

  assertNonEmptyString(data.lendingAdmin.package, 'lendingAdmin.package')
  assertNonEmptyString(data.lendingAdmin.storage, 'lendingAdmin.storage')
  assertNonEmptyString(data.lendingAdmin.incentiveV3, 'lendingAdmin.incentiveV3')
  assertNonEmptyString(data.lendingAdmin.flashloanConfig, 'lendingAdmin.flashloanConfig')
  assertNonEmptyString(data.lendingAdmin.poolAdminCap, 'lendingAdmin.poolAdminCap')
  assertNonEmptyString(data.lendingAdmin.storageAdminCap, 'lendingAdmin.storageAdminCap')
  assertNonEmptyString(data.lendingAdmin.ownerCap, 'lendingAdmin.ownerCap')
  assertNonEmptyString(data.lendingAdmin.incentiveOwnerCap, 'lendingAdmin.incentiveOwnerCap')
  assertNonEmptyString(data.oracle.packageId, 'oracle.packageId')
  assertNonEmptyString(data.oracle.priceOracle, 'oracle.priceOracle')
  assertNonEmptyString(data.oracle.oracleAdminCap, 'oracle.oracleAdminCap')
  assertNonEmptyString(data.oracle.oracleFeederCap, 'oracle.oracleFeederCap')
  assertNonEmptyString(data.oracle.oracleConfig, 'oracle.oracleConfig')
}

async function fetchAdminConfigResponse(url: string): Promise<AdminConfigApiResponse> {
  const response = await fetch(url, { headers: requestHeaders })

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''
    throw new Error(
      `Open API request failed for getAdminConfig(): HTTP ${response.status}${statusText}`
    )
  }

  return (await response.json()) as AdminConfigApiResponse
}

function normalizeAdminConfigOptions(
  options?: AdminConfigRequestOptions
): NormalizedAdminConfigOptions {
  const market = getMarketConfig(options?.market ?? DEFAULT_MARKET_IDENTITY)

  return {
    env: options?.env ?? DEFAULT_ENV,
    market: market.key,
    disableCache: options?.disableCache,
    cacheTime: options?.cacheTime ?? DEFAULT_CACHE_TIME
  }
}

const getAdminConfigCached = withCache(
  withSingleton(async (options: NormalizedAdminConfigOptions): Promise<AdminConfig> => {
    const market = getMarketConfig(options.market)
    const url = `https://open-api.naviprotocol.io/api/navi/config?env=${options.env}&sdk=${packageJson.version}&market=${market.key}`

    const data = (await fetchAdminConfigResponse(url)).data
    assertAdminConfigPayload(data)

    return {
      lending: data.lendingAdmin,
      oracle: data.oracle,
      reserveMetadata: data.reserveMetadata,
      market,
      version: data.version
    }
  })
)

/**
 * Fetches the lending admin config required by admin PTB builders.
 */
export const getAdminConfig = (options?: AdminConfigRequestOptions): Promise<AdminConfig> =>
  getAdminConfigCached(normalizeAdminConfigOptions(options))
