import type { LendingConfig, EnvOption, CacheOption } from './types'
import { withCache, withSingleton } from './utils'

export const getConfig = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<LendingConfig> => {
    const url = `https://open-api.naviprotocol.io/api/navi/config?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)
