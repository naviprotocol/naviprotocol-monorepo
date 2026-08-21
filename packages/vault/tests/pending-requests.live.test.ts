/**
 * Live check that the Volo requests endpoint still has the shape the mapper assumes,
 * gated behind NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * The offline tests pin the mapping against a hand-written body, which says nothing about
 * whether the service still sends that body. Nothing is signed and nothing is submitted.
 */
import { describe, expect, it } from 'vitest'
import { createVaultSdk } from '../src'
import { buildOrSkip } from './live'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

/** Holds Volo positions; found by walking the wBTC vault's `receipts` Table. */
const HOLDER = '0x2d0b70079315356c76179332a8431e0c17d9f4c44eafc2f434fcdf9e8cc4be25'

describe.skipIf(!runLiveTests)('getPendingRequests', () => {
  it('reaches the endpoint and returns entries the cancel builders can use', async () => {
    const sdk = createVaultSdk({ core: {} }, 'prod')
    const requests = await buildOrSkip('getPendingRequests', () =>
      sdk.user.getPendingRequests(HOLDER)
    )
    if (!requests) return

    // A holder usually has nothing queued — operators settle within minutes — so an empty
    // list is the expected result and only the reachable-and-parsed part is asserted.
    expect(Array.isArray(requests)).toBe(true)
    for (const request of requests) {
      expect(request.requestId).not.toBe('')
      expect(request.receiptId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(['deposit', 'withdraw']).toContain(request.type)
      expect(request.requestTime).toBeGreaterThan(0)
    }
  }, 120_000)

  it('rejects an unknown path rather than silently returning nothing', async () => {
    // Guards the assertion above: if the endpoint had been renamed, the test would pass on
    // an empty list. This proves a wrong path is loud.
    const sdk = createVaultSdk({ core: {} }, 'prod', {
      endpoints: { volo: { baseUrl: 'https://vault-api.volosui.com/api/v1/does-not-exist' } }
    })
    await expect(sdk.user.getPendingRequests(HOLDER)).rejects.toMatchObject({
      code: 'API_REQUEST_FAILED'
    })
  }, 120_000)
})
