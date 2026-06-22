export type NaviAggregatorServiceEndpoint = {
  baseUrl?: string
  headers?: Record<string, string>
}

export type NaviAggregatorSdkServiceOptions = {
  naviOpenApi?: NaviAggregatorServiceEndpoint
}

export type NaviAggregatorSdkConfig = {
  services?: NaviAggregatorSdkServiceOptions
}

export type AggregatorServiceEndpointOption = {
  services?: NaviAggregatorSdkServiceOptions
}

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'

let globalConfig: NaviAggregatorSdkConfig = {}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

export function configureNaviAggregatorSdk(config: NaviAggregatorSdkConfig) {
  globalConfig = {
    ...globalConfig,
    ...config,
    services: {
      ...globalConfig.services,
      ...config.services
    }
  }
}

export function resolveNaviOpenApiEndpoint(
  options?: AggregatorServiceEndpointOption
): Required<NaviAggregatorServiceEndpoint> {
  const endpoint = options?.services?.naviOpenApi ?? globalConfig.services?.naviOpenApi
  return {
    baseUrl: normalizeBaseUrl(endpoint?.baseUrl ?? DEFAULT_NAVI_OPEN_API_BASE_URL),
    headers: endpoint?.headers ?? {}
  }
}
