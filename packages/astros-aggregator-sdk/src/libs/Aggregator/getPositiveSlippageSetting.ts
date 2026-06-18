import axios from 'axios'
import { withCache, withSingleton } from './utils'

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'

type PositiveSlippageServiceOptions = {
  baseUrl?: string
  headers?: Record<string, string>
}

function buildPositiveSlippageUrl(baseUrl = DEFAULT_NAVI_OPEN_API_BASE_URL) {
  return `${baseUrl.replace(/\/+$/, '')}/internal/ag/positive-slippage`
}

/**
 * Fetches the remote positive slippage setting from the API
 *
 * @param options - Optional caching options
 * @returns Promise<boolean> - Whether positive slippage should be enabled
 */
export const getRemotePositiveSlippageSetting = withCache(
  withSingleton(
    async (options?: {
      disableCache?: boolean
      cacheTime?: number
      service?: PositiveSlippageServiceOptions
    }): Promise<boolean> => {
      const resp = await axios.get(buildPositiveSlippageUrl(options?.service?.baseUrl), {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          ...options?.service?.headers
        }
      })
      return resp.data.data.should_enable_positive_slippage
    }
  )
)
