import { withCache, withSingleton, getPoolsMap, getEmodesMap } from './utils'
import type {
  MarketIdentity,
  EnvOption,
  CacheOption,
  EMode,
  MarketConfig,
  Pool,
  EModePool
} from './types'
import { getPools } from './pool'
import BigNumber from 'bignumber.js'

export const DEFAULT_MARKET_IDENTITY = 'main'

export const MARKETS = {
  main: {
    id: 0,
    key: 'main',
    name: 'Main Market'
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
            const supplyableAsset = emode.assets.find(
              (a) => a.isCollateral && a.ltv > 0 && a.assetId !== pool.id
            )
            if (supplyableAsset) {
              emodeBorrowablePoolIds.add(pool.uniqueId)
            }
          }
          if (asset.isCollateral) {
            emodeSupplyablePoolIds.add(pool.uniqueId)
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
      const pools = await getPools({
        cacheTime: 1000 * 60,
        ...options,
        markets
      })
      return markets.map((market) => {
        const marketConfig = getMarketConfig(market)
        const marketPools = pools.filter((pool) => {
          return pool.market === marketConfig.key
        })
        return new Market(market, marketPools)
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
