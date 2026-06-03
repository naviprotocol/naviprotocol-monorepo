import { describe, it, expect } from 'vitest'
import { getPriceFeeds, filterPriceFeeds, getPythStalePriceFeedId } from '../src/oracle'
import { getLendingState } from '../src/account'
import { OraclePriceFeed } from '../src/types'
import { getPools } from '../src/pool'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'
let allFeeds: OraclePriceFeed[] = [
  { oracleId: 1, pythPriceFeedId: 'feed-1' } as OraclePriceFeed,
  { oracleId: 2, pythPriceFeedId: 'feed-2' } as OraclePriceFeed,
  { oracleId: 3, pythPriceFeedId: 'feed-3' } as OraclePriceFeed
]

describe.skipIf(!runLiveTests)('getPriceFeeds', () => {
  it('response success', async () => {
    allFeeds = await getPriceFeeds()
    expect(allFeeds.length).toBeGreaterThan(0)
  })
})

describe('filterPriceFeeds', () => {
  it('filterPriceFeeds by userLendingState fixture', async () => {
    const filteredFeeds = filterPriceFeeds(allFeeds, {
      lendingState: [{ pool: { oracleId: 2 } }] as any
    })
    expect(filteredFeeds.map((feed) => feed.oracleId)).toEqual([2])
  })

  it.skipIf(!runLiveTests)('filterPriceFeeds by userLendingState', async () => {
    const lendingState = await getLendingState(
      '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
    )
    const filteredFeeds = filterPriceFeeds(allFeeds, {
      lendingState
    })
    expect(filteredFeeds.length).toBeGreaterThan(0)
    expect(filteredFeeds.length).toBeLessThan(allFeeds.length)
  })

  it.skipIf(!runLiveTests)('filterPriceFeeds by pools', async () => {
    const pools = await getPools()
    const filteredFeeds = filterPriceFeeds(allFeeds, {
      pools: pools.slice(0, 3)
    })
    expect(filteredFeeds.length).toEqual(3)
  })
})

describe.skipIf(!runLiveTests)('getPythStalePriceFeedId', () => {
  it('response success', async () => {
    const stalePriceFeedIds = await getPythStalePriceFeedId(
      allFeeds.map((feed) => feed.pythPriceFeedId)
    )
    expect(stalePriceFeedIds).toBeDefined()
  })
})
