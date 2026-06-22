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
let globalConfigVersion = 0

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

function mergeNaviOpenApiEndpoint(
  previous?: NaviAggregatorServiceEndpoint,
  next?: NaviAggregatorServiceEndpoint
): NaviAggregatorServiceEndpoint | undefined {
  if (!next) {
    return previous
  }

  return {
    ...previous,
    ...next,
    headers: next.headers
      ? {
          ...previous?.headers,
          ...next.headers
        }
      : previous?.headers
  }
}

export function configureNaviAggregatorSdk(config: NaviAggregatorSdkConfig) {
  const naviOpenApi = mergeNaviOpenApiEndpoint(
    globalConfig.services?.naviOpenApi,
    config.services?.naviOpenApi
  )

  globalConfig = {
    ...globalConfig,
    ...config,
    services: {
      ...globalConfig.services,
      ...config.services,
      ...(naviOpenApi ? { naviOpenApi } : {})
    }
  }
  globalConfigVersion += 1
}

export function getNaviAggregatorSdkConfigVersion() {
  return globalConfigVersion
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
