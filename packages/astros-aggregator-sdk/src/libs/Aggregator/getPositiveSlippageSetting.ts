import axios from 'axios'
import { withCache, withSingleton } from './utils'

/**
 * Fetches the remote positive slippage setting from the API
 *
 * @param options - Optional caching options
 * @returns Promise<boolean> - Whether positive slippage should be enabled
 */
export const getRemotePositiveSlippageSetting = withCache(
  withSingleton(
    async (options?: { disableCache?: boolean; cacheTime?: number }): Promise<boolean> => {
      const resp = await axios.get(
        'https://open-api.naviprotocol.io/api/internal/ag/positive-slippage',
        {
          headers: {
            'User-Agent': 'navi-aggregator-sdk'
          }
        }
      )
      return resp.data.data.should_enable_positive_slippage
    }
  )
)
