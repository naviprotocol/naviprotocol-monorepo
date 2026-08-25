import { LendingConfig, getConfig, DEFAULT_CACHE_TIME } from '@naviprotocol/lending'
import { Vault } from '../../types'

export async function getMarketConfig(market: string | LendingConfig) {
  if (typeof market === 'string') {
    return await getConfig({
      market,
      cacheTime: DEFAULT_CACHE_TIME
    })
  }
}

export function checkVault(vault: Vault) {
  if (!vault.navi) {
    throw new Error(`vault ${vault.id} not navi vault`)
  }
}
