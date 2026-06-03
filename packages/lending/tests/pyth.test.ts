import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuiPriceServiceConnection } from '../src/pyth'

describe('SuiPriceServiceConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes price IDs when fetching latest price feeds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.getAll('ids[]')).toEqual(['abc123'])
      return new Response(
        JSON.stringify([
          {
            id: 'abc123',
            price: {
              price: '100',
              conf: '1',
              expo: -8,
              publish_time: 123
            }
          }
        ])
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const connection = new SuiPriceServiceConnection('https://hermes.pyth.network/')
    const feeds = await connection.getLatestPriceFeeds(['0xabc123'])

    expect(feeds?.[0].id).toBe('abc123')
    expect(feeds?.[0].getPriceUnchecked().publishTime).toBe(123)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('decodes VAA update data from Hermes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([btoa(String.fromCharCode(1, 2, 3))])))
    )

    const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
    const [vaa] = await connection.getPriceFeedsUpdateData(['abc123'])

    expect(Array.from(vaa)).toEqual([1, 2, 3])
  })
})
