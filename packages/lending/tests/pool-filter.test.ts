import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPools } from '../src/pool'

/** Minimal pool row with every field `getPools` post-processing touches. */
const pool = {
  id: 0,
  market: 'main',
  contract: { pool: '0xabc' },
  token: { decimals: 9 },
  oracle: { price: '1' },
  totalSupplyAmount: '0',
  borrowedAmount: '0',
  validBorrowAmount: '0',
  supplyCapCeiling: '0'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPools', () => {
  it('tolerates the pools-filtered response, which carries no meta.emodes', async () => {
    // GET /navi/pools?...&pools=<id> returns { code, data } without `meta`.
    const fetchMock = vi.fn(async () => ({ json: async () => ({ code: 0, data: [pool] }) }))
    vi.stubGlobal('fetch', fetchMock)

    const pools = await getPools({ pools: ['0xabc'], disableCache: true })

    expect(pools).toHaveLength(1)
    expect(pools[0].emodes).toEqual([])
    expect(fetchMock.mock.calls[0][0]).toContain('&pools=0xabc')
  })

  it('still attaches e-modes when meta is present', async () => {
    const emode = { emodeId: 0, marketId: 0, isActive: true, assets: [{ assetId: 0 }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ code: 0, data: [pool], meta: { emodes: [emode] } })
      }))
    )

    const pools = await getPools({ disableCache: true })
    expect(pools[0].emodes).toEqual([emode])
  })
})
