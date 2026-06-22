import { describe, expect, it, vi } from 'vitest'

const axiosGet = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
  default: {
    get: axiosGet
  }
}))

describe('positive slippage service endpoint configuration', () => {
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

  it('lets per-call Open API endpoints override the aggregator global endpoint', async () => {
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
          'x-call': '1'
        }
      }
    )
  })
})
