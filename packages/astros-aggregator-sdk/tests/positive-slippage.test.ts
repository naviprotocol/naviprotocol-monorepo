import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
  default: {
    get: axiosGet
  }
}))

describe('positive slippage service endpoint configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    axiosGet.mockReset()
  })

  it('uses the aggregator global Open API endpoint when no per-call service is provided', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet.mockResolvedValueOnce({
      data: {
        data: {
          should_enable_positive_slippage: true
        }
      }
    })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://preview-open-api.example/api/',
          headers: {
            'x-navi-preview': '1'
          }
        }
      }
    })

    await expect(getRemotePositiveSlippageSetting({ disableCache: true })).resolves.toBe(true)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://preview-open-api.example/api/internal/ag/positive-slippage',
      {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          'x-navi-preview': '1'
        }
      }
    )
  })

  it('lets per-call Open API endpoints override the aggregator global endpoint fields', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet.mockResolvedValueOnce({
      data: {
        data: {
          should_enable_positive_slippage: false
        }
      }
    })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://global-open-api.example/api',
          headers: {
            'x-global': '1'
          }
        }
      }
    })

    await expect(
      getRemotePositiveSlippageSetting({
        disableCache: true,
        service: {
          baseUrl: 'https://call-open-api.example/api/',
          headers: {
            'x-call': '1'
          }
        }
      })
    ).resolves.toBe(false)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://call-open-api.example/api/internal/ag/positive-slippage',
      {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          'x-global': '1',
          'x-call': '1'
        }
      }
    )
  })

  it('keeps the global Open API baseUrl when a per-call service only adds headers', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet.mockResolvedValueOnce({
      data: {
        data: {
          should_enable_positive_slippage: true
        }
      }
    })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://preview-open-api.example/api',
          headers: {
            'x-global': '1',
            'x-shared': 'global'
          }
        }
      }
    })

    await expect(
      getRemotePositiveSlippageSetting({
        disableCache: true,
        service: {
          headers: {
            'x-call': '1',
            'x-shared': 'call'
          }
        }
      })
    ).resolves.toBe(true)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://preview-open-api.example/api/internal/ag/positive-slippage',
      {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          'x-global': '1',
          'x-shared': 'call',
          'x-call': '1'
        }
      }
    )
  })

  it('keeps global Open API headers when a per-call service only changes baseUrl', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet.mockResolvedValueOnce({
      data: {
        data: {
          should_enable_positive_slippage: true
        }
      }
    })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://global-open-api.example/api',
          headers: {
            'x-global': '1'
          }
        }
      }
    })

    await expect(
      getRemotePositiveSlippageSetting({
        disableCache: true,
        service: {
          baseUrl: 'https://call-open-api.example/api/'
        }
      })
    ).resolves.toBe(true)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://call-open-api.example/api/internal/ag/positive-slippage',
      {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          'x-global': '1'
        }
      }
    )
  })

  it('does not reuse cached positive slippage settings after the global endpoint changes', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet
      .mockResolvedValueOnce({
        data: {
          data: {
            should_enable_positive_slippage: true
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            should_enable_positive_slippage: false
          }
        }
      })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://first-open-api.example/api'
        }
      }
    })
    await expect(getRemotePositiveSlippageSetting()).resolves.toBe(true)

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://second-open-api.example/api'
        }
      }
    })
    await expect(getRemotePositiveSlippageSetting()).resolves.toBe(false)

    expect(axiosGet).toHaveBeenCalledTimes(2)
    expect(axiosGet).toHaveBeenNthCalledWith(
      1,
      'https://first-open-api.example/api/internal/ag/positive-slippage',
      expect.anything()
    )
    expect(axiosGet).toHaveBeenNthCalledWith(
      2,
      'https://second-open-api.example/api/internal/ag/positive-slippage',
      expect.anything()
    )
  })

  it('preserves global Open API headers when a later partial config only changes baseUrl', async () => {
    const { configureNaviAggregatorSdk } = await import('../src/libs/Aggregator/services')
    const { getRemotePositiveSlippageSetting } = await import(
      '../src/libs/Aggregator/getPositiveSlippageSetting'
    )
    axiosGet.mockResolvedValueOnce({
      data: {
        data: {
          should_enable_positive_slippage: true
        }
      }
    })

    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://first-open-api.example/api',
          headers: {
            'x-auth': 'token',
            'x-preview': '1'
          }
        }
      }
    })
    configureNaviAggregatorSdk({
      services: {
        naviOpenApi: {
          baseUrl: 'https://second-open-api.example/api/'
        }
      }
    })

    await expect(getRemotePositiveSlippageSetting({ disableCache: true })).resolves.toBe(true)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://second-open-api.example/api/internal/ag/positive-slippage',
      {
        headers: {
          'User-Agent': 'navi-aggregator-sdk',
          'x-auth': 'token',
          'x-preview': '1'
        }
      }
    )
  })
})
