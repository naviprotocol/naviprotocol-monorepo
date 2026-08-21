import { VaultSdkError } from '../errors'
import type { CreateVaultSdkOptions } from '../types'

/**
 * The two backends the SDK reads from.
 *
 * Named after the service, not after {@link VaultApp}: `astros` vaults are served by the
 * Volo API under `?protocol=astros`, so they are `volo` here.
 */
export type VaultService = 'navi' | 'volo'

export interface VaultServiceEndpoint {
  baseUrl: string
  headers?: Record<string, string>
}

export type VaultEndpoints = Partial<Record<VaultService, VaultServiceEndpoint>>

const DEFAULT_ENDPOINTS: Record<VaultService, VaultServiceEndpoint> = {
  navi: { baseUrl: 'https://navi-vault-api.naviprotocol.io/api/v1' },
  volo: { baseUrl: 'https://vault-api.volosui.com/api/v1' }
}

export interface VaultTransportRequest {
  service: VaultService
  path: string
  query?: Record<string, string | number | boolean | undefined>
  /** Skip the cache for this request. */
  disableCache?: boolean
  /** Override the cache lifetime for this request, in milliseconds. */
  cacheTime?: number
}

export interface VaultTransport {
  get<T>(request: VaultTransportRequest): Promise<T>
}

const DEFAULT_CACHE_TIME = 30_000

function pruneExpired(cache: Map<string, { at: number }>, cacheTime: number): void {
  const cutoff = Date.now() - cacheTime
  for (const [key, entry] of cache) {
    if (entry.at <= cutoff) cache.delete(key)
  }
}

function buildUrl(endpoint: VaultServiceEndpoint, request: VaultTransportRequest): string {
  const base = endpoint.baseUrl.replace(/\/+$/, '')
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`
  const query = Object.entries(request.query ?? {}).filter(([, value]) => value !== undefined)
  if (query.length === 0) return `${base}${path}`
  const search = new URLSearchParams(query.map(([key, value]) => [key, String(value)]))
  return `${base}${path}?${search.toString()}`
}

export function createVaultTransport(options: Readonly<CreateVaultSdkOptions>): VaultTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new VaultSdkError(
      'API_REQUEST_FAILED',
      'No fetch implementation available. Pass one as options.fetch.'
    )
  }

  const cache = new Map<string, { at: number; body: unknown }>()
  const defaultCacheTime = options.vaultCacheTime ?? DEFAULT_CACHE_TIME

  return {
    async get<T>(request: VaultTransportRequest): Promise<T> {
      const endpoint = options.endpoints?.[request.service] ?? DEFAULT_ENDPOINTS[request.service]
      const url = buildUrl(endpoint, request)

      const cacheTime = request.cacheTime ?? defaultCacheTime
      const cached = cache.get(url)
      if (!request.disableCache && cached && Date.now() - cached.at < cacheTime) {
        return cached.body as T
      }
      // Entries are keyed by url and user-scoped paths carry an address, so without this a
      // long-lived process would keep one entry per holder for as long as it runs.
      pruneExpired(cache, cacheTime)

      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: { accept: 'application/json', ...options.headers, ...endpoint.headers }
        })
      } catch (error) {
        throw new VaultSdkError('API_REQUEST_FAILED', `GET ${url} failed.`, { cause: error })
      }

      if (!response.ok) {
        throw new VaultSdkError(
          'API_REQUEST_FAILED',
          `GET ${url} returned ${response.status} ${response.statusText}.`
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch (error) {
        throw new VaultSdkError('API_RESPONSE_INVALID', `GET ${url} returned invalid JSON.`, {
          cause: error
        })
      }

      cache.set(url, { at: Date.now(), body })
      return body as T
    }
  }
}

/**
 * Pulls a list out of a response.
 *
 * The two services disagree on the envelope: NAVI wraps lists in `{ data }`, Volo wraps
 * `/vaults` in `{ total, data, page, ... }` but returns `/users/:address/position` as a
 * bare array. Normalising here rather than asking two services to agree.
 */
export function unwrapList<T>(body: unknown, label: string): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data as T[]
  throw new VaultSdkError(
    'API_RESPONSE_INVALID',
    `${label} returned neither an array nor { data: [...] }.`
  )
}

/**
 * Pulls a single object out of a response, treating an absent one as `null` rather than an
 * error — `getVault` reports a missing vault that way.
 */
export function unwrapItem<T>(body: unknown): T | null {
  if (body === null || body === undefined) return null
  const wrapped = body as { data?: unknown }
  if ('data' in wrapped) return (wrapped.data ?? null) as T | null
  return body as T
}
