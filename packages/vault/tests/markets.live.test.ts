/**
 * Live check that `@naviprotocol/lending` resolves each of a vault's markets, gated behind
 * NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * The lending-side objects used to be configured on the vault; they are now read from
 * lending by market code. The offline suite mocks that call, so this is what would catch a
 * market code the config service does not serve — including the isolated pair markets the
 * Prime vaults run on.
 */
import { describe, expect, it } from 'vitest'
import { resolveMarkets } from '../src/protocols/navi-lending/markets'
import { suiHighYield, suiPrime } from './fixtures'
import { buildOrSkip } from './live'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

const CERT = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'

describe.skipIf(!runLiveTests)('resolveMarkets', () => {
  it("resolves all three of SUI High Yield's markets, RewardFund included", async () => {
    const resolved = await buildOrSkip('resolveMarkets', () =>
      resolveMarkets(suiHighYield(), { env: 'prod' })
    )
    if (!resolved) return

    expect(resolved.map((market) => market.code)).toEqual(['main', 'sui-eco', 'vsui-sui'])
    for (const market of resolved) {
      expect(market.poolObjectId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(market.storageObjectId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(market.incentiveV2ObjectId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(market.incentiveV3ObjectId).toMatch(/^0x[0-9a-f]{64}$/)
    }

    // The one active reward rule harvests CERT from main.
    const main = resolved.find((market) => market.isDefault)!
    expect(main.code).toBe('main')
    expect(main.rewardFunds[CERT]).toMatch(/^0x[0-9a-f]{64}$/)
  }, 120_000)

  it('resolves an isolated pair market, which SUI Prime routes deposits to', async () => {
    // vsui-sui is not one of the four shared markets, and was unreachable through the
    // lending SDK before its market list was extended.
    const resolved = await buildOrSkip('resolveMarkets prime', () =>
      resolveMarkets(suiPrime(), { env: 'prod' })
    )
    if (!resolved) return

    const target = resolved.find((market) => market.isDefault)!
    expect(target.code).toBe('vsui-sui')
    expect(target.poolObjectId).toMatch(/^0x[0-9a-f]{64}$/)
    expect(target.storageObjectId).toMatch(/^0x[0-9a-f]{64}$/)
  }, 120_000)
})
