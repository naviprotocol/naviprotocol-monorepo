import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  getMarketConfig,
  getMarket,
  getMarkets,
  MARKETS,
  DEFAULT_MARKET_IDENTITY,
  Market
} from '../src/market'
import { getPools } from '../src/pool'
import type { Pool, EModeIdentity, EnvOption } from '../src/types'

const options = {
  env: 'test'
} as EnvOption

describe('getMarketConfig', () => {
  it('should get market config by string key', () => {
    const config = getMarketConfig('main')
    expect(config).toBeDefined()
    expect(config.id).toBe(0)
    expect(config.key).toBe('main')
    expect(config.name).toBe('Main Market')
  })

  it('should get market config by number id', () => {
    const config = getMarketConfig(0)
    expect(config).toBeDefined()
    expect(config.id).toBe(0)
    expect(config.key).toBe('main')
    expect(config.name).toBe('Main Market')
  })

  it('should get market config by MarketConfig object', () => {
    const marketConfig = { id: 0, key: 'main', name: 'Main Market' }
    const config = getMarketConfig(marketConfig)
    expect(config).toBeDefined()
    expect(config.id).toBe(0)
    expect(config.key).toBe('main')
    expect(config.name).toBe('Main Market')
  })

  it('should throw error for non-existent market', () => {
    expect(() => getMarketConfig(999)).toThrow('Market not found')
    expect(() => getMarketConfig('non-existent')).toThrow('Market not found')
    expect(() => getMarketConfig({ id: 999, key: 'non-existent', name: 'Non-existent' })).toThrow(
      'Market not found'
    )
  })
})

describe('MARKETS constant', () => {
  it('should have main market defined', () => {
    expect(MARKETS.main).toBeDefined()
    expect(MARKETS.main.id).toBe(0)
    expect(MARKETS.main.key).toBe('main')
    expect(MARKETS.main.name).toBe('Main Market')
  })
})

describe('DEFAULT_MARKET_IDENTITY', () => {
  it('should be "main"', () => {
    expect(DEFAULT_MARKET_IDENTITY).toBe('main')
  })
})

describe('getMarket', () => {
  it('should get market with string identity', async () => {
    const market = await getMarket('main', options)
    expect(market).toBeDefined()
    expect(market.config).toBeDefined()
    expect(market.config.id).toBe(0)
    expect(market.config.key).toBe('main')
    expect(market.pools).toBeDefined()
    expect(Array.isArray(market.pools)).toBe(true)
    expect(market.emodes).toBeDefined()
    expect(Array.isArray(market.emodes)).toBe(true)
  })

  it('should get market with number identity', async () => {
    const market = await getMarket(0, options)
    expect(market).toBeDefined()
    expect(market.config).toBeDefined()
    expect(market.config.id).toBe(0)
    expect(market.pools.length).toBeGreaterThan(0)
  })

  it('should get market with MarketConfig object', async () => {
    const marketConfig = { id: 0, key: 'main', name: 'Main Market' }
    const market = await getMarket(marketConfig, options)
    expect(market).toBeDefined()
    expect(market.config.id).toBe(0)
  })
})

describe('getMarkets', () => {
  it('should get multiple markets', async () => {
    const markets = await getMarkets(['main'], options)
    expect(markets).toBeDefined()
    expect(Array.isArray(markets)).toBe(true)
    expect(markets.length).toBe(1)
    expect(markets[0].config.id).toBe(0)
  })

  it('should get markets with different identities', async () => {
    const markets = await getMarkets([0, 'main'], options)
    expect(markets).toBeDefined()
    expect(markets.length).toBe(2)
    expect(markets[0].config.id).toBe(0)
    expect(markets[1].config.id).toBe(0)
  })
})

describe('Market class', () => {
  let testPools: Pool[] = []

  beforeAll(async () => {
    testPools = await getPools(options)
  })

  describe('constructor', () => {
    it('should create market instance with pools', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)
      expect(market).toBeDefined()
      expect(market.config.id).toBe(0)
      expect(market.pools.length).toBe(pools.length)
      expect(market.emodes.length).toBeGreaterThanOrEqual(0)
    })

    it('should filter pools by market', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)
      market.pools.forEach((pool) => {
        expect(pool.market).toBe(market.config.key)
      })
    })
  })

  describe('addPools', () => {
    it('should add new pools', () => {
      const initialPools = testPools.slice(0, 2)
      const market = new Market('main', initialPools)
      const initialLength = market.pools.length

      const newPools = testPools.slice(2, 4)
      market.addPools(newPools)
      expect(market.pools.length).toBeGreaterThanOrEqual(initialLength)
    })

    it('should not add duplicate pools', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)
      const initialLength = market.pools.length

      market.addPools(pools)
      expect(market.pools.length).toBe(initialLength)
    })

    it('should warn and skip pools from different market', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)
      const initialLength = market.pools.length

      // Create a pool with different market id
      const differentMarketPool: Pool = {
        ...pools[0],
        id: 999,
        market: 'other'
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      market.addPools([differentMarketPool])
      expect(market.pools.length).toBe(initialLength)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should add emodes from pools', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)
      const initialEmodeLength = market.emodes.length

      const newPools = testPools.slice(2, 4)
      market.addPools(newPools)
      // Emodes might increase if new pools have new emodes
      expect(market.emodes.length).toBeGreaterThanOrEqual(initialEmodeLength)
    })
  })

  describe('getEMode', () => {
    it('should get emode by EModeIdentity', () => {
      const pools = testPools.slice(0, 5)
      const market = new Market('main', pools)

      if (market.emodes.length > 0) {
        const emode = market.emodes[0]
        const emodeIdentity: EModeIdentity = {
          emodeId: emode.emodeId,
          marketId: emode.marketId
        }
        const result = market.getEMode(emodeIdentity)
        expect(result).toBeDefined()
        expect(result?.emodeId).toBe(emode.emodeId)
        expect(result?.marketId).toBe(emode.marketId)
      }
    })

    it('should return null for non-existent emode', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)

      const emodeIdentity: EModeIdentity = {
        emodeId: 99999,
        marketId: 0
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = market.getEMode(emodeIdentity)
      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return null and warn for different market emode', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)

      if (market.emodes.length > 0) {
        const emode = market.emodes[0]
        const emodeIdentity: EModeIdentity = {
          emodeId: emode.emodeId,
          marketId: 999 // Different market
        }

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const result = market.getEMode(emodeIdentity)
        expect(result).toBeNull()
        expect(consoleSpy).toHaveBeenCalled()
        consoleSpy.mockRestore()
      }
    })
  })

  describe('getEModePools', () => {
    it('should get emode pools', () => {
      const pools = testPools.slice(0, 5)
      const market = new Market('main', pools)

      if (market.emodes.length > 0) {
        const emode = market.emodes[0]
        const emodeIdentity: EModeIdentity = {
          emodeId: emode.emodeId,
          marketId: emode.marketId
        }
        const emodePools = market.getEModePools(emodeIdentity)
        expect(Array.isArray(emodePools)).toBe(true)
        emodePools.forEach((pool) => {
          expect(pool.isEMode).toBe(true)
          expect(pool.emode).toBeDefined()
          expect(pool.emode.emodeId).toBe(emode.emodeId)
        })
      }
    })

    it('should return empty array for non-existent emode', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)

      const emodeIdentity: EModeIdentity = {
        emodeId: 99999,
        marketId: 0
      }

      const emodePools = market.getEModePools(emodeIdentity)
      expect(emodePools).toEqual([])
    })

    it('should return empty array for different market emode', () => {
      const pools = testPools.slice(0, 2)
      const market = new Market('main', pools)

      if (market.emodes.length > 0) {
        const emode = market.emodes[0]
        const emodeIdentity: EModeIdentity = {
          emodeId: emode.emodeId,
          marketId: 999 // Different market
        }

        const emodePools = market.getEModePools(emodeIdentity)
        expect(emodePools).toEqual([])
      }
    })
  })
})
