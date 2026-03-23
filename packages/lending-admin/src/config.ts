/**
 * Lending Admin configuration module.
 */

import type { AdminConfig, ResolveConfigOptions } from './types'
import { withCache, withSingleton, requestHeaders } from './utils'
import packageJson from '../package.json'

/**
 * The default market key for admin configuration.
 */
export const DEFAULT_ADMIN_MARKET = 'main'

/**
 * Default cache time for configuration, 5 minutes.
 */
export const DEFAULT_CACHE_TIME = 1000 * 60 * 5

/**
 * Deterministic fallback config for local PTB unit tests.
 */
export const defaultAdminConfig: AdminConfig = {
  package: '0x0000000000000000000000000000000000000000000000000000000000000001',
  storage: '0x1111111111111111111111111111111111111111111111111111111111111111',
  incentiveV2: '0x2222222222222222222222222222222222222222222222222222222222222222',
  incentiveV3: '0x3333333333333333333333333333333333333333333333333333333333333333',
  priceOracle: '0x4444444444444444444444444444444444444444444444444444444444444444',
  flashloanConfig: '0x5555555555555555555555555555555555555555555555555555555555555555',
  storageAdminCap: '0x6666666666666666666666666666666666666666666666666666666666666666',
  storageOwnerCap: '0x7777777777777777777777777777777777777777777777777777777777777777',
  poolAdminCap: '0x8888888888888888888888888888888888888888888888888888888888888888',
  incentiveOwner: '0x9999999999999999999999999999999999999999999999999999999999999999',
  borrowFeeCap: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  suiPoolId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  oracle: {
    packageId: '0x000000000000000000000000000000000000000000000000000000000000cccc',
    priceOracle: '0x4444444444444444444444444444444444444444444444444444444444444444',
    oracleAdminCap: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    oracleConfig: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    oracleFeederCap: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  }
}

/**
 * Fetch lending admin configuration from open-api.
 */
export const getAdminConfig = withCache(
  withSingleton(async (options?: ResolveConfigOptions): Promise<AdminConfig> => {
    if (options?.config) {
      return options.config
    }
    const env = options?.env || 'prod'
    const market = options?.market || DEFAULT_ADMIN_MARKET
    const url = `https://open-api.naviprotocol.io/api/navi/config?env=${env}&sdk=${packageJson.version}&market=${market}`
    const res = await fetch(url, { headers: requestHeaders }).then((response) => response.json())
    return res.data
  })
)
