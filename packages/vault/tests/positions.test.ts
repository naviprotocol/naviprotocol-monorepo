import { describe, expect, it, vi } from 'vitest'
import { createVaultSdk, VaultSdkError } from '../src'
import { OWNER } from './fixtures'

const NAVI_VAULT = `0x${'5'.repeat(64)}`
const VOLO_VAULT = `0x${'6'.repeat(64)}`
const ASTROS_VAULT = `0x${'7'.repeat(64)}`
const NAVI_ON_VOLO = `0x${'8'.repeat(64)}`

/** NAVI's service wraps the list; every row is a `navi` vault. */
const NAVI_BODY = {
  data: [
    {
      vaultId: NAVI_VAULT,
      protocol: 'navi',
      shares: 99974,
      poolShareTokenBalance: 0.100869,
      poolShareTokenUsd: 0.10097,
      vaultApr: 0.0697206087,
      yieldLifetimeAmount: 0.005325938239118846,
      yieldLifetimeUsd: 0.005331,
      coinType: '0x2::sui::SUI',
      coinSymbol: 'SUI',
      coinDecimals: 9,
      coinIconUrl: 'https://example.invalid/sui.svg',
      coinPrice: 1.001,
      claimableRewardsUsd: 0.004461,
      yieldBreakdown: {
        realizedUsd: 0,
        unrealizedUsd: 0.00087,
        claimedUsd: 0,
        claimableUsd: 0.004461
      }
    }
  ]
}

/** Volo's service returns a bare array, and mixes three apps on one contract. */
const VOLO_BODY = [
  {
    vaultId: VOLO_VAULT,
    protocol: 'volo',
    shares: 69027630406,
    poolShareTokenBalance: 0.0006066457112634387,
    poolShareTokenUsd: 45.399454294731775,
    vaultApr: 2.092,
    yieldLifetimeAmount: 0.000021023116277655912,
    yieldLifetimeUsd: 1.5733038062570297,
    pendingDeposit: 0,
    tokenPrice: 74836.850326
  },
  { vaultId: ASTROS_VAULT, protocol: 'astros', shares: 1, poolShareTokenBalance: 2 },
  { vaultId: NAVI_ON_VOLO, protocol: 'navi', shares: 3, poolShareTokenBalance: 4 }
]

function sdkWith(bodies: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string) => {
    const body = url.includes('volosui') ? bodies.volo : bodies.navi
    return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response
  })
  return { sdk: createVaultSdk({ core: {} }, 'prod', { fetch }), fetch }
}

function bothServices() {
  return sdkWith({ navi: NAVI_BODY, volo: VOLO_BODY })
}

describe('getPositions', () => {
  it('reads both services and normalises the two envelopes', async () => {
    const { sdk, fetch } = bothServices()
    const positions = await sdk.user.getPositions(OWNER)

    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      `https://navi-vault-api.naviprotocol.io/api/v1/users/${OWNER}/position`,
      `https://vault-api.volosui.com/api/v1/users/${OWNER}/position`
    ])
    expect(positions.map((position) => position.vaultId)).toEqual([
      NAVI_VAULT,
      VOLO_VAULT,
      ASTROS_VAULT,
      NAVI_ON_VOLO
    ])
  })

  it('lifts every field both services report to the top level', async () => {
    const { sdk } = bothServices()
    const [navi] = await sdk.user.getPositions(OWNER, { app: ['navi'], vaults: [NAVI_VAULT] })
    expect(navi).toMatchObject({
      vaultId: NAVI_VAULT,
      owner: OWNER,
      shares: 99974,
      amount: 0.100869,
      amountUsd: 0.10097,
      apr: 0.0697206087,
      yieldLifetimeAmount: 0.005325938239118846,
      yieldLifetimeUsd: 0.005331
    })
  })

  it("reads the coin price from each service's own name for it", async () => {
    // NAVI calls it coinPrice, Volo calls it tokenPrice; it is the same value.
    const { sdk } = bothServices()
    const [navi] = await sdk.user.getPositions(OWNER, { vaults: [NAVI_VAULT] })
    const [volo] = await sdk.user.getPositions(OWNER, { vaults: [VOLO_VAULT] })
    expect(navi!.coinPrice).toBe(1.001)
    expect(volo!.coinPrice).toBe(74836.850326)
  })

  it('groups the fields only NAVI reports under `navi`', async () => {
    const { sdk } = bothServices()
    const [navi] = await sdk.user.getPositions(OWNER, { vaults: [NAVI_VAULT] })
    expect(navi!.navi).toEqual({
      coinType: '0x2::sui::SUI',
      coinSymbol: 'SUI',
      coinDecimals: 9,
      coinIconUrl: 'https://example.invalid/sui.svg',
      claimableRewardsUsd: 0.004461,
      yieldBreakdown: {
        realizedUsd: 0,
        unrealizedUsd: 0.00087,
        claimedUsd: 0,
        claimableUsd: 0.004461
      }
    })
    expect(navi!.volo).toBeUndefined()
  })

  it('groups the fields only Volo reports under `volo`', async () => {
    const { sdk } = bothServices()
    const [volo] = await sdk.user.getPositions(OWNER, { vaults: [VOLO_VAULT] })
    expect(volo!.volo).toEqual({ pendingDeposit: 0 })
    expect(volo!.navi).toBeUndefined()
  })

  it('tags a NAVI-branded vault served by Volo with `volo`, since that is where the row came from', async () => {
    const { sdk } = bothServices()
    const [position] = await sdk.user.getPositions(OWNER, { vaults: [NAVI_ON_VOLO] })
    expect(position!.volo).toBeDefined()
    expect(position!.navi).toBeUndefined()
  })

  it('leaves amountUsd undefined when the service omits it', async () => {
    const { sdk } = bothServices()
    const [astros] = await sdk.user.getPositions(OWNER, { vaults: [ASTROS_VAULT] })
    expect(astros!.amountUsd).toBeUndefined()
  })

  it('still reads the Volo service when only navi is asked for', async () => {
    // A NAVI-branded vault can run on the Volo contract, so the app is not a proxy for
    // which service serves it.
    const { sdk, fetch } = bothServices()
    const positions = await sdk.user.getPositions(OWNER, { app: ['navi'] })
    expect(positions.map((position) => position.vaultId)).toEqual([NAVI_VAULT, NAVI_ON_VOLO])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('skips the NAVI service when navi is not asked for', async () => {
    const { sdk, fetch } = bothServices()
    const positions = await sdk.user.getPositions(OWNER, { app: ['volo'] })
    expect(positions.map((position) => position.vaultId)).toEqual([VOLO_VAULT])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('separates astros from volo even though they share a service', async () => {
    const { sdk } = bothServices()
    const positions = await sdk.user.getPositions(OWNER, { app: ['astros'] })
    expect(positions.map((position) => position.vaultId)).toEqual([ASTROS_VAULT])
  })

  it('filters by vault', async () => {
    const { sdk } = bothServices()
    const positions = await sdk.user.getPositions(OWNER, { vaults: [VOLO_VAULT, NAVI_VAULT] })
    expect(positions.map((position) => position.vaultId)).toEqual([NAVI_VAULT, VOLO_VAULT])
  })

  it('handles a holder with nothing, on either service', async () => {
    const { sdk } = sdkWith({ navi: { data: [] }, volo: [] })
    expect(await sdk.user.getPositions(OWNER)).toEqual([])
  })

  it('drops a row with no vault id rather than returning one nothing can be done with', async () => {
    const { sdk } = sdkWith({ navi: { data: [{ shares: 1 }] }, volo: [] })
    expect(await sdk.user.getPositions(OWNER)).toEqual([])
  })

  it('rejects a body in neither envelope instead of reporting no positions', async () => {
    const { sdk } = sdkWith({ navi: { positions: [] }, volo: [] })
    await expect(sdk.user.getPositions(OWNER)).rejects.toMatchObject({
      code: 'API_RESPONSE_INVALID'
    })
  })

  it('requires an owner', async () => {
    const { sdk } = bothServices()
    await expect(sdk.user.getPositions('')).rejects.toThrow(VaultSdkError)
  })
})
