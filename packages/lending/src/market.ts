import { withCache, withSingleton } from './utils'
import type {
  MarketIdentity,
  EnvOption,
  CacheOption,
  EMode,
  MarketConfig,
  Pool,
  EModeIdentity,
  EModePool
} from './types'
import { getPools } from './pool'
import { getPoolsMap, getEmodesMap } from './utils'

export const DEFAULT_MARKET_IDENTITY = 'main'

export const MARKETS = {
  main: {
    id: 0,
    key: 'main',
    name: 'Main Market'
  }
}

export class Market {
  readonly config: MarketConfig
  readonly pools: Pool[] = []
  readonly emodes: EMode[] = []

  constructor(marketIdentity: MarketIdentity, pools: Pool[]) {
    this.config = getMarketConfig(marketIdentity)
    this.addPools(pools)
  }

  public addPools(pools: Pool[]) {
    const poolsMap = getPoolsMap(this.pools)
    const emodesMap = getEmodesMap(this.emodes)
    pools.forEach((pool) => {
      const isMatch = this.checkMarket(pool.market)
      if (!isMatch) {
        console.warn(`Pool is not in market ${this.config.name}`, pool)
        return
      }
      if (!poolsMap[pool.id]) {
        this.pools.push(pool)
      }
      pool.emodes.forEach((emode) => {
        if (!emodesMap[emode.emodeId]) {
          this.emodes.push(emode)
        }
      })
    })
  }

  public getEMode(emodeIdentity: EModeIdentity): EMode | null {
    const isMatch = this.checkMarket(emodeIdentity.marketId)
    if (!isMatch) {
      console.warn(
        `EMode market mismatch ${this.config.id} !== ${emodeIdentity.marketId}`,
        emodeIdentity
      )
      return null
    }
    const emodesMap = getEmodesMap(this.emodes)
    const emode = emodesMap[emodeIdentity.emodeId]
    if (!emode) {
      console.warn(
        `EMode not found ${emodeIdentity.emodeId} in market ${this.config.name}`,
        emodeIdentity
      )
      return null
    }
    return emode
  }

  public getEModePools(emodeIdentity: EModeIdentity): EModePool[] {
    const emode = this.getEMode(emodeIdentity)
    if (!emode) {
      return []
    }
    const assetIds = emode.assets.map((asset) => asset.assetId)
    const pools = this.pools.filter((pool) => {
      return assetIds.includes(pool.id)
    })
    return pools.map((pool) => {
      return {
        ...pool,
        emode,
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

export const getMarketConfig = (marketIdentity: MarketIdentity) => {
  const configs = Object.values(MARKETS)
  const config = configs.find((marketConfig) => {
    if (typeof marketIdentity === 'number') {
      return marketConfig.id === marketIdentity
    }
    if (typeof marketIdentity === 'string') {
      return marketConfig.key === marketIdentity
    }
    return marketConfig.id === marketIdentity.id
  })
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
      const res = await Promise.all(
        markets.map((marketConfig) => {
          return getPools({
            cacheTime: 1000 * 60,
            ...options,
            market: marketConfig
          })
        })
      )
      return res.map((pools) => {
        const marketConfig = pools[0].market
        return new Market(marketConfig, pools)
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
