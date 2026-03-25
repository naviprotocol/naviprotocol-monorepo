import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { filterPriceFeeds, getPriceFeeds, getPythStalePriceFeedId } from '../src/oracle'
import type { LendingPosition, OraclePriceFeed, UserLendingInfo } from '../src/types'
import { TEST_ACCOUNT_CAP, TEST_CONFIG, createPoolFixture, testObjectId } from './fixtures'

const { getConfigMock, getLatestPriceFeedsMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getLatestPriceFeedsMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

vi.mock('@pythnetwork/pyth-sui-js', () => ({
  SuiPriceServiceConnection: class {
    async getLatestPriceFeeds(priceIds: string[]) {
      return getLatestPriceFeedsMock(priceIds)
    }
  },
  SuiPythClient: class {}
}))

const TEST_FEEDS: OraclePriceFeed[] = [
  {
    oracleId: 0,
    feedId: 'feed-sui',
    assetId: 0,
    pythPriceFeedId: 'pyth-sui',
    pythPriceInfoObject: testObjectId(60),
    coinType: '0x2::sui::SUI',
    priceDecimal: 9,
    supraPairId: 1
  },
  {
    oracleId: 1,
    feedId: 'feed-usdc',
    assetId: 1,
    pythPriceFeedId: 'pyth-usdc',
    pythPriceInfoObject: testObjectId(61),
    coinType: `${testObjectId(62)}::usdc::USDC`,
    priceDecimal: 6,
    supraPairId: 2
  },
  {
    oracleId: 2,
    feedId: 'feed-navx',
    assetId: 2,
    pythPriceFeedId: 'pyth-navx',
    pythPriceInfoObject: testObjectId(63),
    coinType: `${testObjectId(64)}::navx::NAVX`,
    priceDecimal: 9,
    supraPairId: 3
  }
]

function createLendingState(assetId: number): UserLendingInfo {
  const pool = createPoolFixture({ id: assetId })
  return {
    assetId,
    borrowBalance: '0',
    supplyBalance: '1000',
    pool,
    market: pool.market
  }
}

function createLendingPosition(assetId: number): LendingPosition {
  const pool = createPoolFixture({ id: assetId })
  return {
    id: `position-${assetId}`,
    wallet: TEST_ACCOUNT_CAP,
    protocol: 'navi',
    market: pool.market,
    type: 'navi-lending-emode-supply',
    'navi-lending-emode-supply': {
      amount: '10',
      valueUSD: '20',
      token: {
        coinType: pool.suiCoinType,
        decimals: pool.token.decimals,
        logoUri: '',
        symbol: pool.token.symbol,
        price: pool.token.price
      },
      pool: {
        ...pool,
        isEMode: true,
        emode: {
          emodeId: 1,
          assetId,
          ltv: 0.8,
          lt: 0.85,
          bonus: 0.05,
          isCollateral: true,
          isDebt: false
        }
      },
      emodeCap: {
        accountCap: TEST_ACCOUNT_CAP,
        emodeId: 1,
        marketId: 0
      }
    }
  }
}

describe('oracle helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConfigMock.mockReset()
    getLatestPriceFeedsMock.mockReset()
    getConfigMock.mockResolvedValue({
      ...TEST_CONFIG,
      oracle: {
        ...TEST_CONFIG.oracle,
        feeds: TEST_FEEDS
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns oracle feeds from the configured lending config', async () => {
    const feeds = await getPriceFeeds({
      env: 'dev'
    })

    expect(feeds).toEqual(TEST_FEEDS)
    expect(getConfigMock).toHaveBeenCalled()
  })

  it('filters price feeds by lending state and pool selection', () => {
    const filtered = filterPriceFeeds(TEST_FEEDS, {
      lendingState: [createLendingState(1)],
      pools: [createPoolFixture({ id: 2 })]
    })

    expect(filtered.map((feed) => feed.assetId)).toEqual([1, 2])
  })

  it('filters price feeds by lending positions without querying live pool state', () => {
    const filtered = filterPriceFeeds(TEST_FEEDS, {
      lendingPositions: [createLendingPosition(2)]
    })

    expect(filtered.map((feed) => feed.assetId)).toEqual([2])
  })

  it('returns only stale Pyth feeds based on publish time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T00:00:40Z'))

    const currentTimestamp = Math.floor(Date.now() / 1000)
    getLatestPriceFeedsMock.mockResolvedValue([
      {
        id: 'stale-feed',
        getPriceUnchecked: () => ({
          publishTime: currentTimestamp - 31
        })
      },
      {
        id: 'fresh-feed',
        getPriceUnchecked: () => ({
          publishTime: currentTimestamp - 10
        })
      },
      {
        id: 'future-feed',
        getPriceUnchecked: () => ({
          publishTime: currentTimestamp + 5
        })
      }
    ])

    const staleIds = await getPythStalePriceFeedId(['stale-feed', 'fresh-feed', 'future-feed'])

    expect(staleIds).toEqual(['stale-feed'])
  })
})
