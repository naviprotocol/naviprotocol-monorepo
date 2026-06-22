import axios from 'axios'
import { withCache, withSingleton } from './utils'
import { getNaviAggregatorSdkConfigVersion, resolveNaviOpenApiEndpoint } from './services'

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'

type PositiveSlippageServiceOptions = {
  baseUrl?: string
  headers?: Record<string, string>
}

type ResolvedPositiveSlippageOptions = {
  disableCache?: boolean
  cacheTime?: number
  service: Required<PositiveSlippageServiceOptions>
  serviceConfigVersion: number
}

function buildPositiveSlippageUrl(baseUrl = DEFAULT_NAVI_OPEN_API_BASE_URL) {
  return `${baseUrl.replace(/\/+$/, '')}/internal/ag/positive-slippage`
}

const getRemotePositiveSlippageSettingCached = withCache(
  withSingleton(async (options: ResolvedPositiveSlippageOptions): Promise<boolean> => {
    const { service } = options
    const resp = await axios.get(buildPositiveSlippageUrl(service.baseUrl), {
      headers: {
        'User-Agent': 'navi-aggregator-sdk',
        ...service.headers
      }
    })
    return resp.data.data.should_enable_positive_slippage
  })
)

/**
 * Fetches the remote positive slippage setting from the API
 *
 * @param options - Optional caching options
 * @returns Promise<boolean> - Whether positive slippage should be enabled
 */
export function getRemotePositiveSlippageSetting(options?: {
  disableCache?: boolean
  cacheTime?: number
  service?: PositiveSlippageServiceOptions
}): Promise<boolean> {
  const service = resolveNaviOpenApiEndpoint({
    services: {
      naviOpenApi: options?.service
    }
  })
  return getRemotePositiveSlippageSettingCached({
    ...options,
    service,
    serviceConfigVersion: getNaviAggregatorSdkConfigVersion()
  })
}
