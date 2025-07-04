import { getConfig, DEFAULT_CACHE_TIME } from './config'
import type { OraclePriceFeed, EnvOption, UserLendingInfo, Pool } from './types'

export async function getPriceFeeds(options?: Partial<EnvOption>): Promise<OraclePriceFeed[]> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return config.oracle.feeds
}

export function filterPriceFeeds(
  feeds: OraclePriceFeed[],
  filters: {
    lendingState?: UserLendingInfo[]
    pools?: Pool[]
  }
): OraclePriceFeed[] {
  return feeds.filter((feed) => {
    if (filters?.lendingState) {
      const inState = filters.lendingState.find((state) => {
        return state.assetId === feed.assetId
      })
      if (inState) {
        return true
      }
    }
    if (filters?.pools) {
      const inPool = filters.pools.find((pool) => {
        return pool.id === feed.assetId
      })
      if (inPool) {
        return true
      }
    }
    return false
  })
}
