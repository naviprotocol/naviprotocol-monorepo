import axios from 'axios'
import { withCache, withSingleton } from './utils'
import { requestHeaders } from '../../../../lending/src/utils'
import { AxiosHeaders } from 'axios'

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
          headers: requestHeaders as AxiosHeaders
        }
      )
      return resp.data.data.should_enable_positive_slippage
    }
  )
)
