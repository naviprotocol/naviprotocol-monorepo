/**
 * Live check that both position endpoints still have the shape the mapper assumes, gated
 * behind NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * The holders below belong to third parties and were found by walking the wBTC vault's
 * `receipts` Table and by the address the API docs use. Nothing is signed or submitted.
 */
import { describe, expect, it } from 'vitest'
import { createVaultSdk } from '../src'
import { buildOrSkip } from './live'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

const NAVI_HOLDER = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const VOLO_HOLDER = '0x2d0b70079315356c76179332a8431e0c17d9f4c44eafc2f434fcdf9e8cc4be25'

function sdk() {
  return createVaultSdk({ core: {} }, 'prod')
}

describe.skipIf(!runLiveTests)('getPositions', () => {
  it('reads real NAVI positions', async () => {
    const positions = await buildOrSkip('getPositions navi', () =>
      sdk().user.getPositions(NAVI_HOLDER, { app: ['navi'] })
    )
    if (!positions) return

    expect(positions.length).toBeGreaterThan(0)
    for (const position of positions) {
      expect(position.vaultId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(position.owner).toBe(NAVI_HOLDER)
      expect(position.shares).toBeGreaterThan(0)
      expect(position.amount).toBeGreaterThan(0)
      // Lifted from the shared part of the response, so a rename upstream shows up here.
      expect(position.apr).toBeGreaterThan(0)
      expect(position.coinPrice).toBeGreaterThan(0)
      // Grouped rather than dropped, which is the half of the unification that is easy to
      // lose without noticing.
      expect(position.navi?.coinType).toMatch(/::/)
      expect(position.navi?.coinDecimals).toBeGreaterThan(0)
    }
  }, 120_000)

  it('reads real Volo positions', async () => {
    const positions = await buildOrSkip('getPositions volo', () =>
      sdk().user.getPositions(VOLO_HOLDER, { app: ['volo'] })
    )
    if (!positions) return

    expect(positions.length).toBeGreaterThan(0)
    for (const position of positions) {
      expect(position.shares).toBeGreaterThan(0)
      expect(position.amountUsd).toBeGreaterThan(0)
      expect(position.apr).toBeGreaterThan(0)
      // Volo reports the same value as `tokenPrice`.
      expect(position.coinPrice).toBeGreaterThan(0)
      expect(position.volo).toBeDefined()
    }
  }, 120_000)
})
