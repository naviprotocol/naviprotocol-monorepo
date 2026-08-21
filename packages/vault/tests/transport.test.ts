import { describe, expect, it, vi } from 'vitest'
import { createVaultTransport, unwrapItem, unwrapList, VaultSdkError } from '../src'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'OK',
    json: async () => body
  } as Response
}

function stubFetch(body: unknown = { data: [] }) {
  return vi.fn(async () => jsonResponse(body))
}

describe('createVaultTransport', () => {
  it('routes each service to its own production base url', async () => {
    const fetch = stubFetch()
    const transport = createVaultTransport({ fetch })
    await transport.get({ service: 'navi', path: '/vaults' })
    await transport.get({ service: 'volo', path: '/vaults' })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://navi-vault-api.naviprotocol.io/api/v1/vaults',
      'https://vault-api.volosui.com/api/v1/vaults'
    ])
  })

  it('appends query parameters and drops the undefined ones', async () => {
    const fetch = stubFetch()
    await createVaultTransport({ fetch }).get({
      service: 'volo',
      path: 'vaults',
      query: { protocol: 'astros', limit: 100, cursor: undefined }
    })
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://vault-api.volosui.com/api/v1/vaults?protocol=astros&limit=100'
    )
  })

  it('lets an endpoint override the base url, and merges headers over the global ones', async () => {
    const fetch = stubFetch()
    await createVaultTransport({
      fetch,
      headers: { 'x-global': 'g', accept: 'text/plain' },
      endpoints: {
        navi: { baseUrl: 'https://staging.example.com/api/v1/', headers: { auth: 'k' } }
      }
    }).get({ service: 'navi', path: '/vaults' })

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://staging.example.com/api/v1/vaults')
    expect((init as RequestInit).headers).toEqual({
      accept: 'text/plain',
      'x-global': 'g',
      auth: 'k'
    })
  })

  it('serves a repeat request from the cache, and refetches when told to skip it', async () => {
    const fetch = stubFetch()
    const transport = createVaultTransport({ fetch })
    await transport.get({ service: 'navi', path: '/vaults' })
    await transport.get({ service: 'navi', path: '/vaults' })
    expect(fetch).toHaveBeenCalledTimes(1)

    await transport.get({ service: 'navi', path: '/vaults', disableCache: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('caches per url, not per service', async () => {
    const fetch = stubFetch()
    const transport = createVaultTransport({ fetch })
    await transport.get({ service: 'navi', path: '/vaults' })
    await transport.get({ service: 'navi', path: '/vaults/0x1' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('treats a zero cache time as no cache', async () => {
    const fetch = stubFetch()
    const transport = createVaultTransport({ fetch, vaultCacheTime: 0 })
    await transport.get({ service: 'navi', path: '/vaults' })
    await transport.get({ service: 'navi', path: '/vaults' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps fresh entries while sweeping expired ones', async () => {
    // Expired entries are swept on every request, because they are keyed by url and
    // user-scoped paths carry an address. Sweeping too eagerly would quietly turn the cache
    // off, which is what this pins down; the eviction itself is not observable from here.
    const fetch = stubFetch()
    const transport = createVaultTransport({ fetch })
    await transport.get({ service: 'navi', path: '/users/0xa/position' })
    for (let i = 0; i < 20; i += 1) {
      await transport.get({ service: 'navi', path: `/users/0x${i}/position` })
    }
    expect(fetch).toHaveBeenCalledTimes(21)

    await transport.get({ service: 'navi', path: '/users/0xa/position' })
    expect(fetch).toHaveBeenCalledTimes(21)
  })

  it('reports a transport failure as API_REQUEST_FAILED, with the cause attached', async () => {
    const cause = new Error('ECONNRESET')
    const fetch = vi.fn(async () => {
      throw cause
    })
    await expect(
      createVaultTransport({ fetch }).get({ service: 'navi', path: '/vaults' })
    ).rejects.toMatchObject({ code: 'API_REQUEST_FAILED', cause })
  })

  it('reports a non-2xx response as API_REQUEST_FAILED, naming the status', async () => {
    const fetch = vi.fn(async () => jsonResponse({}, { ok: false, status: 503 }))
    await expect(
      createVaultTransport({ fetch }).get({ service: 'navi', path: '/vaults' })
    ).rejects.toThrow(/503/)
  })

  it('reports an unparseable body as API_RESPONSE_INVALID', async () => {
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => {
            throw new Error('Unexpected token <')
          }
        }) as Response
    )
    await expect(
      createVaultTransport({ fetch }).get({ service: 'navi', path: '/vaults' })
    ).rejects.toMatchObject({ code: 'API_RESPONSE_INVALID' })
  })

  it('falls back to globalThis.fetch, and says so when there is none', () => {
    expect(() => createVaultTransport({})).not.toThrow()

    const original = globalThis.fetch
    try {
      // @ts-expect-error removing it is the whole point
      delete globalThis.fetch
      expect(() => createVaultTransport({})).toThrow(/options.fetch/)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('unwrapList', () => {
  it('accepts both envelopes the two services use', () => {
    // Volo returns /users/:address/position as a bare array; NAVI wraps it in { data }.
    expect(unwrapList<number>([1, 2], 'x')).toEqual([1, 2])
    expect(unwrapList<number>({ data: [1] }, 'x')).toEqual([1])
    // Volo's /vaults adds pagination around the same key.
    expect(unwrapList<number>({ total: 1, data: [1], page: 1 }, 'x')).toEqual([1])
  })

  it('rejects anything else rather than returning an empty list', () => {
    expect(() => unwrapList({ items: [] }, 'GET /vaults')).toThrow(VaultSdkError)
    expect(() => unwrapList(null, 'GET /vaults')).toThrow(/GET \/vaults/)
  })
})

describe('unwrapItem', () => {
  it('unwraps { data } and passes a bare object through', () => {
    expect(unwrapItem<{ id: string }>({ data: { id: 'a' } })).toEqual({ id: 'a' })
    expect(unwrapItem<{ id: string }>({ id: 'a' })).toEqual({ id: 'a' })
  })

  it('reports an absent item as null, which is how getVault reports a miss', () => {
    expect(unwrapItem({ data: null })).toBeNull()
    expect(unwrapItem(null)).toBeNull()
  })
})
