import type { MarketConfig, MarketIdentity } from './types'

export const DEFAULT_MARKET_IDENTITY = 'main'

export const MARKETS: Record<string, MarketConfig> = {
  main: {
    id: 0,
    key: 'main',
    name: 'Main Market'
  },
  ember: {
    id: 1,
    key: 'ember',
    name: 'Ember Market'
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
    throw new Error('Market not found')
  }
  return config
}
