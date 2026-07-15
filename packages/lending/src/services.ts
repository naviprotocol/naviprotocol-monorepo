export type NaviServiceEndpoint = {
  baseUrl: string
  headers?: Record<string, string>
}

export type NaviSdkServiceOptions = {
  naviOpenApi?: NaviServiceEndpoint
  astrosApi?: NaviServiceEndpoint
}

export type NaviSdkConfig = {
  services?: NaviSdkServiceOptions
}

export type ServiceEndpointOption = {
  services?: NaviSdkServiceOptions
}

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'

let globalConfig: NaviSdkConfig = {}
let serviceConfigVersion = 0

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

export function configureNaviSdk(config: NaviSdkConfig) {
  globalConfig = {
    ...globalConfig,
    ...config,
    services: {
      ...globalConfig.services,
      ...config.services
    }
  }
  serviceConfigVersion += 1
}

export function getNaviSdkConfigVersion() {
  return serviceConfigVersion
}

export function resolveNaviOpenApiEndpoint(options?: ServiceEndpointOption): NaviServiceEndpoint {
  const endpoint = options?.services?.naviOpenApi ?? globalConfig.services?.naviOpenApi
  return {
    baseUrl: normalizeBaseUrl(endpoint?.baseUrl ?? DEFAULT_NAVI_OPEN_API_BASE_URL),
    headers: endpoint?.headers
  }
}

export function buildNaviOpenApiUrl(path: string, options?: ServiceEndpointOption) {
  const endpoint = resolveNaviOpenApiEndpoint(options)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${endpoint.baseUrl}${normalizedPath}`
}

function headersInitToRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers
}

export function mergeServiceHeaders(defaults: HeadersInit, endpoint?: NaviServiceEndpoint) {
  return {
    ...headersInitToRecord(defaults),
    ...(endpoint?.headers ?? {})
  }
}
