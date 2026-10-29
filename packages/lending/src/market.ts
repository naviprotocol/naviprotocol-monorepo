import { withCache, withSingleton, getPoolsMap, getEmodesMap, requestHeaders } from './utils'
import type {
  MarketIdentity,
  EnvOption,
  CacheOption,
  EMode,
  MarketConfig,
  Pool,
  EModePool,
  ServiceOption
} from './types'
import { getPools } from './pool'
import BigNumber from 'bignumber.js'
import packageJson from '../package.json'
import { buildNaviOpenApiUrl, mergeServiceHeaders, resolveNaviOpenApiEndpoint } from './services'

export const DEFAULT_MARKET_IDENTITY = 'main'

export const MARKETS = {
  main: {
    id: 0,
    key: 'main',
    name: 'Main Market'
  },
  ember: {
    id: 1,
    key: 'ember',
    name: 'eACRED / USDC Market'
  },
  rwa: {
    id: 2,
    key: 'rwa',
    name: 'Matrixdock Market'
  },
  'sui-eco': {
    id: 3,
    key: 'sui-eco',
    name: 'Sui Eco Market'
  },
  'sui-usdc': {
    id: 4,
    key: 'sui-usdc',
    name: 'SUI / USDC Market'
  },
  'wbtc-usdc': {
    id: 5,
    key: 'wbtc-usdc',
    name: 'WBTC / USDC Market'
  },
  'xbtc-usdc': {
    id: 6,
    key: 'xbtc-usdc',
    name: 'xBTC / USDC Market'
  },
  'vsui-usdc': {
    id: 7,
    key: 'vsui-usdc',
    name: 'vSUI / USDC Market'
  },
  'vsui-sui': {
    id: 8,
    key: 'vsui-sui',
    name: 'vSUI / SUI Market'
  },
  'hasui-sui': {
    id: 9,
    key: 'hasui-sui',
    name: 'haSUI / SUI Market'
  },
  'high-usdc': {
    id: 10,
    key: 'high-usdc',
    name: 'HIGH / USDC Market'
  },
  'eearn-usdc': {
    id: 11,
    key: 'eearn-usdc',
    name: 'eEARN / USDC Market'
  },
  'hbtc-usdc': {
    id: 12,
    key: 'hbtc-usdc',
    name: 'hBTC / USDC Market'
  }
}

export class Market {
  private poolMap = {} as Record<string, Pool>
  private emodeMap = {} as Record<string, EMode>
  readonly config: MarketConfig
  readonly pools: Pool[] = []
  readonly emodes: EMode[] = []
  readonly emodePools: EModePool[] = []
  emodeBorrowablePools: Pool[] = []
  emodeSupplyablePools: Pool[] = []

  private _overview = {
    marketTotalSupplyValue: '0',
    marketTotalBorrowValue: '0'
  }

  get overview() {
    return this._overview
  }

  constructor(marketIdentity: MarketIdentity, pools: Pool[]) {
    this.config = getMarketConfig(marketIdentity)
    this.initPools(pools)
  }

  private initPools(pools: Pool[]) {
    const poolsMap = getPoolsMap(this.pools)
    const emodesMap = getEmodesMap(this.emodes)
    const emodeBorrowablePoolIds = new Set<string>()
    const emodeSupplyablePoolIds = new Set<string>()
    let marketTotalSupplyValue = BigNumber(0)
    let marketTotalBorrowValue = BigNumber(0)

    pools.forEach((pool) => {
      const isMatch = this.checkMarket(pool.market)
      if (!isMatch) {
        console.warn(`Pool is not in market ${this.config.name}`, pool)
        return
      }
      if (!poolsMap[pool.uniqueId]) {
        this.pools.push(pool)
      }
      pool?.emodes?.forEach((emode) => {
        if (!emodesMap[emode.uniqueId]) {
          this.emodes.push(emode)
        }
        emode.assets.forEach((asset) => {
          if (asset.isDebt) {
            const debtAsset = emode.assets.find(
              (a) => a.isCollateral && a.ltv > 0 && a.assetId !== pool.id
            )
            if (debtAsset) {
              emodeBorrowablePoolIds.add(pool.uniqueId)
            }
          }
          if (asset.isCollateral) {
            const supplyAsset = emode.assets.find((a) => a.isDebt && a.assetId !== pool.id)
            if (supplyAsset) {
              emodeSupplyablePoolIds.add(pool.uniqueId)
            }
          }
        })
      })
      marketTotalBorrowValue = marketTotalBorrowValue.plus(pool.poolBorrowValue)
      marketTotalSupplyValue = marketTotalSupplyValue.plus(pool.poolSupplyValue)
    })
    this.poolMap = getPoolsMap(this.pools, 'id')
    this.emodeMap = getEmodesMap(this.emodes, 'emodeId')
    this.emodes.forEach((emode) => {
      const emodePools = this.getEModePools(emode.emodeId)
      this.emodePools.push(...emodePools)
    })
    this._overview = {
      marketTotalSupplyValue: marketTotalSupplyValue.toString(),
      marketTotalBorrowValue: marketTotalBorrowValue.toString()
    }
    this.emodeBorrowablePools = this.pools.filter((pool) => {
      return emodeBorrowablePoolIds.has(pool.uniqueId)
    })
    this.emodeSupplyablePools = this.pools.filter((pool) => {
      return emodeSupplyablePoolIds.has(pool.uniqueId)
    })
  }

  public getEMode(emodeId: number): EMode | null {
    const emode = this.emodeMap[emodeId]
    return emode || null
  }

  public getEModeRelatePools(
    pool: Pool,
    options?: {
      collateral?: boolean
      debt?: boolean
      emodeId?: number
    }
  ): Pool[] {
    const { collateral, debt, emodeId } = options || {}
    const relatePools = [] as Pool[]
    pool.emodes.forEach((emode) => {
      if (typeof emodeId === 'number' && emodeId !== emode.emodeId) {
        return
      }
      emode.assets.forEach((asset) => {
        if (
          typeof collateral === 'boolean' &&
          collateral &&
          asset.isCollateral &&
          asset.assetId === pool.id
        ) {
          relatePools.push(this.poolMap[asset.assetId])
        }
        if (typeof debt === 'boolean' && debt && asset.isDebt && asset.assetId === pool.id) {
          relatePools.push(this.poolMap[asset.assetId])
        }
      })
    })
    return relatePools
  }

  public getEModePools(emodeId: number): EModePool[] {
    const emode = this.getEMode(emodeId)
    if (!emode) {
      return []
    }
    const pools = emode.assets
      .map((asset) => asset.assetId)
      .map((id) => {
        return this.poolMap[id]
      })
      .filter((pool) => !!pool)
    return pools.map((pool) => {
      const asset = emode.assets.find((asset) => asset.assetId === pool.id)!
      return {
        ...pool,
        emode: {
          ...asset,
          emodeId: emode.emodeId
        },
        isEMode: true
      }
    })
  }

  private checkMarket(marketIdentity: MarketIdentity) {
    let isMatch = false
    if (typeof marketIdentity === 'number' && marketIdentity === this.config.id) {
      isMatch = true
    }
    if (typeof marketIdentity === 'string' && marketIdentity === this.config.key) {
      isMatch = true
    }
    if (typeof marketIdentity === 'object' && marketIdentity.id === this.config.id) {
      isMatch = true
    }
    return isMatch
  }
}

export type MarketEnv = EnvOption['env']

export type MarketConfigsOptions = Partial<EnvOption & CacheOption & ServiceOption>

export type RegisterMarketConfigsOptions = {
  env?: MarketEnv
  /**
   * The caller is itself the source of truth for this env's market list (e.g.
   * open-api registering its own config). `loadMarketConfigs` then returns the
   * registered list without an HTTP round trip.
   */
  authoritative?: boolean
}

const DEFAULT_MARKET_ENV: MarketEnv = 'prod'
const MARKET_CONFIGS_CACHE_TIME = 1000 * 60 * 5
// Callers (pools, positions, rewards) await the market list, so a stalled
// /navi/markets must fall back instead of blocking them.
const MARKET_CONFIGS_TIMEOUT = 5000
const LOG_PREFIX = '[@naviprotocol/lending]'

const BUILTIN_MARKET_CONFIGS: MarketConfig[] = Object.values(MARKETS)

// Per-env market lists loaded from open-api or registered by the caller. The
// built-in MARKETS stay as the fallback when an env has nothing loaded yet.
const marketConfigsByEnv: Partial<Record<MarketEnv, MarketConfig[]>> = {}
const authoritativeEnvs = new Set<MarketEnv>()

const matchesIdentity = (marketConfig: MarketConfig, marketIdentity: MarketIdentity) => {
  if (typeof marketIdentity === 'number') {
    return marketConfig.id === marketIdentity
  }
  if (typeof marketIdentity === 'string') {
    return marketConfig.key === marketIdentity
  }
  // A config carries both: the key tells apart two envs' markets that share
  // an id.
  return marketConfig.id === marketIdentity.id && marketConfig.key === marketIdentity.key
}

const isMarketConfig = (value: any): value is MarketConfig => {
  return (
    typeof value?.id === 'number' &&
    typeof value?.key === 'string' &&
    !!value.key &&
    typeof value?.name === 'string'
  )
}

/**
 * Validates a market list and keeps the built-in identity for known markets:
 * a known key keeps its built-in id and display name, so switching the source
 * to open-api never changes what an existing market resolves to or shows.
 */
const normalizeMarketConfigs = (configs: unknown[]): MarketConfig[] => {
  const normalized: MarketConfig[] = []
  const seenKeys = new Set<string>()
  const seenIds = new Set<number>()
  configs.forEach((item) => {
    if (!isMarketConfig(item)) {
      console.warn(`${LOG_PREFIX} Ignoring invalid market config`, item)
      return
    }
    if (seenKeys.has(item.key)) {
      return
    }
    const builtin = BUILTIN_MARKET_CONFIGS.find((config) => config.key === item.key)
    if (builtin) {
      if (builtin.id !== item.id) {
        console.warn(
          `${LOG_PREFIX} Market "${item.key}" id ${item.id} conflicts with built-in id ${builtin.id}; using built-in`
        )
      }
      seenKeys.add(builtin.key)
      seenIds.add(builtin.id)
      normalized.push({ id: builtin.id, key: builtin.key, name: builtin.name })
      return
    }
    // A new key must not reuse an id that already identifies another market:
    // id lookups (number or object identity) would resolve to the wrong one.
    const idOwner =
      BUILTIN_MARKET_CONFIGS.find((config) => config.id === item.id) ||
      (seenIds.has(item.id) ? normalized.find((config) => config.id === item.id) : undefined)
    if (idOwner) {
      console.warn(
        `${LOG_PREFIX} Ignoring market "${item.key}": id ${item.id} already belongs to "${idOwner.key}"`
      )
      return
    }
    seenKeys.add(item.key)
    seenIds.add(item.id)
    normalized.push({ id: item.id, key: item.key, name: item.name })
  })
  return normalized
}

/**
 * Replaces the market list of an env with the given configs.
 *
 * Registration only seeds the list: unless `authoritative` is set, a later
 * `loadMarketConfigs` still fetches from open-api and replaces it.
 */
export const registerMarketConfigs = (
  configs: MarketConfig[],
  options?: RegisterMarketConfigsOptions
): MarketConfig[] => {
  const env = options?.env || DEFAULT_MARKET_ENV
  const normalized = normalizeMarketConfigs(configs || [])
  if (normalized.length === 0) {
    console.warn(`${LOG_PREFIX} Ignoring empty market list for env "${env}"`)
    return getMarketConfigs({ env })
  }
  marketConfigsByEnv[env] = normalized
  if (options?.authoritative) {
    authoritativeEnvs.add(env)
  }
  return normalized
}

/**
 * Returns the market list of an env: the loaded/registered list when present,
 * otherwise the built-in MARKETS.
 */
export const getMarketConfigs = (options?: { env?: MarketEnv }): MarketConfig[] => {
  const env = options?.env || DEFAULT_MARKET_ENV
  return marketConfigsByEnv[env] || BUILTIN_MARKET_CONFIGS
}

const fetchMarketConfigs = withCache(
  withSingleton(async (options: MarketConfigsOptions): Promise<MarketConfig[]> => {
    const endpoint = resolveNaviOpenApiEndpoint(options)
    const url = buildNaviOpenApiUrl(
      `/navi/markets?env=${options.env}&sdk=${packageJson.version}`,
      options
    )
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new Error(`Timed out after ${MARKET_CONFIGS_TIMEOUT}ms`))
      }, MARKET_CONFIGS_TIMEOUT)
    })
    const request = (async () => {
      const res = await fetch(url, {
        headers: mergeServiceHeaders(requestHeaders, endpoint),
        signal: controller?.signal
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      return res.json()
    })()
    // The losing side of the race must not surface as an unhandled rejection.
    request.catch(() => undefined)
    const json = await Promise.race([request, timeout]).finally(() => clearTimeout(timer))
    const markets = json?.data?.markets
    if (!Array.isArray(markets)) {
      throw new Error('Invalid /navi/markets response')
    }
    const normalized = normalizeMarketConfigs(markets)
    if (normalized.length === 0) {
      throw new Error('Empty /navi/markets response')
    }
    return normalized
  })
)

/**
 * Loads the market list of an env from open-api (`/navi/markets`) and stores
 * it for `getMarketConfigs` / `getMarketConfig`.
 *
 * Never throws: on any failure it keeps whatever the env already has (the
 * built-in MARKETS by default) and logs a warning.
 */
export const loadMarketConfigs = async (
  options?: MarketConfigsOptions
): Promise<MarketConfig[]> => {
  const env = options?.env || DEFAULT_MARKET_ENV
  if (authoritativeEnvs.has(env)) {
    return getMarketConfigs({ env })
  }
  try {
    const configs = await fetchMarketConfigs({
      cacheTime: MARKET_CONFIGS_CACHE_TIME,
      ...(options?.services ? { services: options.services } : {}),
      ...(options?.disableCache ? { disableCache: true } : {}),
      ...(options?.cacheTime !== undefined ? { cacheTime: options.cacheTime } : {}),
      env
    })
    // An authoritative registration that landed while the request was in
    // flight wins over the fetched list.
    if (authoritativeEnvs.has(env)) {
      return getMarketConfigs({ env })
    }
    marketConfigsByEnv[env] = configs
    return configs
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} Failed to load markets for env "${env}", using the current list`,
      error
    )
    return getMarketConfigs({ env })
  }
}

/**
 * Resolves a market by id, key or config. Searches the built-in MARKETS first
 * (unchanged behavior for every existing market), then the loaded or
 * registered list of `options.env`, so a market that only exists in open-api
 * resolves too. Without an env it searches every env's list.
 */
export const getMarketConfig = (marketIdentity: MarketIdentity, options?: { env?: MarketEnv }) => {
  let config = BUILTIN_MARKET_CONFIGS.find((marketConfig) =>
    matchesIdentity(marketConfig, marketIdentity)
  )
  if (!config) {
    const envLists = options?.env
      ? [marketConfigsByEnv[options.env]]
      : Object.values(marketConfigsByEnv)
    for (const configs of envLists) {
      config = configs?.find((marketConfig) => matchesIdentity(marketConfig, marketIdentity))
      if (config) {
        break
      }
    }
  }
  if (!config) {
    throw new Error(`Market not found`)
  }
  return config
}

export const getMarkets = withCache(
  withSingleton(
    async (
      markets: MarketIdentity[],
      options?: Partial<EnvOption & CacheOption>
    ): Promise<Market[]> => {
      const pools = await getPools({
        cacheTime: 1000 * 60,
        ...options,
        markets
      })
      return markets.map((market) => {
        const marketConfig = getMarketConfig(market, { env: options?.env || 'prod' })
        const marketPools = pools.filter((pool) => {
          return pool.market === marketConfig.key
        })
        // Pass the resolved config: a config identity (id + key) cannot pick
        // up another env's market that shares the id.
        return new Market(marketConfig, marketPools)
      })
    }
  )
)

export const getMarket = withCache(
  withSingleton(
    async (market: MarketIdentity, options?: Partial<EnvOption & CacheOption>): Promise<Market> => {
      const markets = await getMarkets([market], options)
      return markets[0]
    }
  )
)
