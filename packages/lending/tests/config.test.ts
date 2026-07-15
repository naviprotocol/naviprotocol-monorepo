import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { getConfig, DEFAULT_CACHE_TIME } from '../src/config'
import { configureNaviSdk } from '../src/services'

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'

describe('getConfig', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const env = new URL(url).searchParams.get('env')
        return {
          json: async () => ({
            data: {
              package:
                env === 'dev'
                  ? '0xc371fc618faca4671253811faef480903b86c58966e8f899184ebaa640120c64'
                  : '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb'
            }
          })
        }
      })
    )
  })

  afterEach(() => {
    configureNaviSdk({
      services: {
        naviOpenApi: {
          baseUrl: DEFAULT_NAVI_OPEN_API_BASE_URL
        }
      }
    })
    vi.unstubAllGlobals()
  })

  it('prod config', async () => {
    const config = await getConfig({ disableCache: true })
    expect(config).toBeDefined()
    expect(config.package).toMatch(/^0x[0-9a-f]{64}$/)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('env=prod'), expect.any(Object))
  })
  it('dev config', async () => {
    const config = await getConfig({ env: 'dev', disableCache: true })
    expect(config).toBeDefined()
    expect(config.package).toMatch(/^0x[0-9a-f]{64}$/)
    expect(config.package).not.toEqual((await getConfig({ disableCache: true })).package)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('env=dev'), expect.any(Object))
  })

  it('invalidates no-options cache entries when the global service endpoint changes', async () => {
    await getConfig()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`${DEFAULT_NAVI_OPEN_API_BASE_URL}/navi/config`),
      expect.any(Object)
    )

    configureNaviSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://preview-open-api.example/api',
          headers: {
            'x-navi-test-endpoint': 'preview'
          }
        }
      }
    })

    await getConfig()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('https://preview-open-api.example/api/navi/config'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-navi-test-endpoint': 'preview'
        })
      })
    )
  })
})

describe('default config', () => {
  it('DEFAULT_CACHE_TIME', async () => {
    expect(DEFAULT_CACHE_TIME).toBeDefined()
  })
})
