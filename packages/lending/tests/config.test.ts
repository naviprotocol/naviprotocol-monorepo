import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig, DEFAULT_CACHE_TIME } from '../src/config'
import { TEST_CONFIG } from './fixtures'

const SUI_ID_PATTERN = /^0x[0-9a-f]{64}$/

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}))

function mockJsonResponse(payload: unknown): Response {
  return {
    json: async () => payload
  } as Response
}

describe('getConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('env=dev')) {
        return mockJsonResponse({
          data: {
            ...TEST_CONFIG,
            package: `0x${'f'.repeat(64)}`
          }
        })
      }

      return mockJsonResponse({
        data: TEST_CONFIG
      })
    })
  })

  it('fetches prod config with the default main market', async () => {
    const config = await getConfig({
      disableCache: true
    })

    expect(config.package).toMatch(SUI_ID_PATTERN)
    expect(config.package).toBe(TEST_CONFIG.package)
    expect(String(fetchMock.mock.calls[0][0])).toContain('env=prod')
    expect(String(fetchMock.mock.calls[0][0])).toContain('market=main')
  })

  it('fetches dev config when env is overridden', async () => {
    const config = await getConfig({
      env: 'dev',
      disableCache: true
    })

    expect(config.package).toMatch(SUI_ID_PATTERN)
    expect(config.package).toBe(`0x${'f'.repeat(64)}`)
    expect(String(fetchMock.mock.calls[0][0])).toContain('env=dev')
  })

  it('keeps prod and dev package ids distinct', async () => {
    const [prodConfig, devConfig] = await Promise.all([
      getConfig({
        disableCache: true
      }),
      getConfig({
        env: 'dev',
        disableCache: true
      })
    ])

    expect(prodConfig.package).not.toEqual(devConfig.package)
  })
})

describe('default config', () => {
  it('DEFAULT_CACHE_TIME', () => {
    expect(DEFAULT_CACHE_TIME).toBeDefined()
    expect(DEFAULT_CACHE_TIME).toBe(1000 * 60 * 5)
  })
})
