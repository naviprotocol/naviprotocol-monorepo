import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MARKET_IDENTITY,
  getMarket,
  getMarketConfig,
  getMarkets,
  MARKETS,
  Market
} from '../src/market'
import type { EnvOption, Pool } from '../src/types'
import { createPoolFixture, TEST_EMODE, testObjectId } from './fixtures'

const { getPoolsMock } = vi.hoisted(() => ({
  getPoolsMock: vi.fn()
}))

vi.mock('../src/pool', () => ({
  getPools: getPoolsMock
}))

const options = {
  env: 'test'
} as EnvOption

const testPools: Pool[] = [
  createPoolFixture({
    id: 0,
    uniqueId: 'main-0',
    poolSupplyValue: '125',
    poolBorrowValue: '25',
    emodes: [TEST_EMODE]
  }),
  createPoolFixture({
    id: 1,
    uniqueId: 'main-1',
    contract: {
      reserveId: testObjectId(27),
      pool: testObjectId(28)
    },
    token: {
      coinType: '0x3::usdc::USDC',
      decimals: 6,
      logoUri: '',
      symbol: 'USDC',
      price: 1
    },
    coinType: '0x3::usdc::USDC',
    suiCoinType: '0x3::usdc::USDC',
    emodes: [],
    poolSupplyValue: '200',
    poolBorrowValue: '50'
  })
]

describe('getMarketConfig', () => {
  it('should get market config by string key', () => {
    const config = getMarketConfig('main')
    expect(config.id).toBe(0)
    expect(config.key).toBe('main')
    expect(config.name).toBe('Main Market')
  })

  it('should get market config by number id', () => {
    const config = getMarketConfig(0)
    expect(config.id).toBe(0)
    expect(config.key).toBe('main')
    expect(config.name).toBe('Main Market')
  })

  it('should get market config by MarketConfig object', () => {
    const marketConfig = { id: 0, key: 'main', name: 'Main Market' }
    const config = getMarketConfig(marketConfig)
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
    expect(MARKETS.main).toEqual({
      id: 0,
      key: 'main',
      name: 'Main Market'
    })
  })
})

describe('DEFAULT_MARKET_IDENTITY', () => {
  it('should be "main"', () => {
    expect(DEFAULT_MARKET_IDENTITY).toBe('main')
  })
})

describe('getMarket', () => {
  beforeEach(() => {
    getPoolsMock.mockReset()
    getPoolsMock.mockResolvedValue(testPools)
  })

  it('should get market with string identity', async () => {
    const market = await getMarket('main', {
      ...options,
      disableCache: true
    })

    expect(market.config.id).toBe(0)
    expect(market.config.key).toBe('main')
    expect(market.pools).toHaveLength(2)
    expect(market.emodes).toHaveLength(1)
  })

  it('should get market with number identity', async () => {
    const market = await getMarket(0, {
      ...options,
      disableCache: true
    })

    expect(market.config.id).toBe(0)
    expect(market.pools.length).toBeGreaterThan(0)
  })

  it('should get market with MarketConfig object', async () => {
    const marketConfig = { id: 0, key: 'main', name: 'Main Market' }
    const market = await getMarket(marketConfig, {
      ...options,
      disableCache: true
    })

    expect(market.config.id).toBe(0)
  })
})

describe('getMarkets', () => {
  beforeEach(() => {
    getPoolsMock.mockReset()
    getPoolsMock.mockResolvedValue(testPools)
  })

  it('should get multiple markets', async () => {
    const markets = await getMarkets(['main'], {
      ...options,
      disableCache: true
    })

    expect(markets).toHaveLength(1)
    expect(markets[0].config.id).toBe(0)
  })

  it('should get markets with different identities', async () => {
    const markets = await getMarkets([0, 'main'], {
      ...options,
      disableCache: true
    })

    expect(markets).toHaveLength(2)
    expect(markets[0].config.id).toBe(0)
    expect(markets[1].config.id).toBe(0)
  })
})

describe('Market class', () => {
  describe('constructor', () => {
    it('should create market instance with pools', () => {
      const market = new Market('main', testPools)

      expect(market.config.id).toBe(0)
      expect(market.pools.length).toBe(testPools.length)
      expect(market.emodes.length).toBeGreaterThanOrEqual(0)
      expect(market.overview.marketTotalSupplyValue).toBe('325')
      expect(market.overview.marketTotalBorrowValue).toBe('75')
    })

    it('should filter pools by market', () => {
      const market = new Market('main', testPools)

      market.pools.forEach((pool) => {
        expect(pool.market).toBe(market.config.key)
      })
    })
  })

  describe('getEMode', () => {
    it('should get emode by emodeId', () => {
      const market = new Market('main', testPools)
      const result = market.getEMode(TEST_EMODE.emodeId)

      expect(result).toBeDefined()
      expect(result?.emodeId).toBe(TEST_EMODE.emodeId)
    })

    it('should return null for non-existent emode', () => {
      const market = new Market('main', testPools)

      expect(market.getEMode(99999)).toBeNull()
    })
  })

  describe('getEModePools', () => {
    it('should get emode pools', () => {
      const market = new Market('main', testPools)
      const emodePools = market.getEModePools(TEST_EMODE.emodeId)

      expect(Array.isArray(emodePools)).toBe(true)
      expect(emodePools).toHaveLength(2)
      emodePools.forEach((pool) => {
        expect(pool.isEMode).toBe(true)
        expect(pool.emode).toBeDefined()
        expect(pool.emode.emodeId).toBe(TEST_EMODE.emodeId)
      })
    })

    it('should return empty array for non-existent emode', () => {
      const market = new Market('main', testPools)

      expect(market.getEModePools(99999)).toEqual([])
    })
  })
})
