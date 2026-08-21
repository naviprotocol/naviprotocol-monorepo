import { describe, expect, it, vi } from 'vitest'
import { createVaultSdk, VaultSdkError } from '../src'
import { OWNER, RECEIPT, voloStable } from './fixtures'

const DEPOSIT = {
  requestId: '1350',
  receiptId: RECEIPT,
  vaultId: voloStable().id,
  amount: '10.5',
  shares: '0',
  status: 'requested',
  executeTime: '2026-08-20T04:15:00.000Z'
}

const WITHDRAWAL = {
  requestId: '634',
  receiptId: RECEIPT,
  vaultId: `0x${'2'.repeat(64)}`,
  amount: '3.25',
  shares: '69027630406',
  status: 'requested',
  executeTime: '2026-08-21T09:00:00.000Z'
}

function sdkWith(body: unknown) {
  const fetch = vi.fn(
    async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response
  )
  return { sdk: createVaultSdk({ core: {} }, 'prod', { fetch }), fetch }
}

describe('getPendingRequests', () => {
  it('reads the Volo endpoint and tags each side with its type', async () => {
    const { sdk, fetch } = sdkWith({ deposits: [DEPOSIT], withdrawals: [WITHDRAWAL] })
    const requests = await sdk.user.getPendingRequests(OWNER)

    expect(fetch.mock.calls[0]![0]).toBe(
      `https://vault-api.volosui.com/api/v1/users/${OWNER}/requests`
    )
    expect(requests.map((request) => request.type)).toEqual(['deposit', 'withdraw'])
  })

  it('carries the request id and receipt id the cancel builders take', async () => {
    const { sdk } = sdkWith({ deposits: [DEPOSIT], withdrawals: [] })
    const [request] = await sdk.user.getPendingRequests(OWNER)

    expect(request).toMatchObject({
      requestId: '1350',
      receiptId: RECEIPT,
      vaultId: voloStable().id,
      owner: OWNER,
      type: 'deposit',
      deposit: { amount: '10.5' }
    })
    // The API reports an ISO instant; the SDK exposes epoch milliseconds.
    expect(request!.requestTime).toBe(Date.parse(DEPOSIT.executeTime))
  })

  it('puts shares on a withdrawal and an amount on a deposit, never both', async () => {
    const { sdk } = sdkWith({ deposits: [DEPOSIT], withdrawals: [WITHDRAWAL] })
    const [deposit, withdrawal] = await sdk.user.getPendingRequests(OWNER)

    expect(deposit!.deposit).toEqual({ amount: '10.5' })
    expect(deposit!.withdraw).toBeUndefined()
    expect(withdrawal!.withdraw).toEqual({ shares: '69027630406' })
    expect(withdrawal!.deposit).toBeUndefined()
  })

  it('filters by type', async () => {
    const { sdk } = sdkWith({ deposits: [DEPOSIT], withdrawals: [WITHDRAWAL] })
    const requests = await sdk.user.getPendingRequests(OWNER, { type: 'withdraw' })
    expect(requests.map((request) => request.requestId)).toEqual(['634'])
  })

  it('filters by vault, accepting an id or a resolved vault', async () => {
    const { sdk } = sdkWith({ deposits: [DEPOSIT], withdrawals: [WITHDRAWAL] })
    expect(
      (await sdk.user.getPendingRequests(OWNER, { vaults: [voloStable()] })).map((r) => r.requestId)
    ).toEqual(['1350'])
    expect(
      (await sdk.user.getPendingRequests(OWNER, { vaults: [WITHDRAWAL.vaultId] })).map(
        (r) => r.requestId
      )
    ).toEqual(['634'])
  })

  it('skips the request entirely when only NAVI is asked for', async () => {
    // NAVI Lending settles inside the caller's transaction, so it never holds a request.
    const { sdk, fetch } = sdkWith({ deposits: [DEPOSIT], withdrawals: [] })
    expect(await sdk.user.getPendingRequests(OWNER, { app: ['navi'] })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('serves astros from the same endpoint as volo', async () => {
    const { sdk, fetch } = sdkWith({ deposits: [DEPOSIT], withdrawals: [] })
    expect(await sdk.user.getPendingRequests(OWNER, { app: ['astros'] })).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('drops an entry missing anything the cancel builders need', async () => {
    const { sdk } = sdkWith({
      deposits: [
        { ...DEPOSIT, requestId: '' },
        { ...DEPOSIT, receiptId: undefined },
        { ...DEPOSIT, vaultId: undefined }
      ],
      withdrawals: []
    })
    expect(await sdk.user.getPendingRequests(OWNER)).toEqual([])
  })

  it('reports an unreadable timestamp as 0 rather than NaN', async () => {
    const { sdk } = sdkWith({
      deposits: [{ ...DEPOSIT, executeTime: 'not a date' }],
      withdrawals: []
    })
    const [request] = await sdk.user.getPendingRequests(OWNER)
    expect(request!.requestTime).toBe(0)
  })

  it('handles the empty shape the API returns for a user with nothing queued', async () => {
    const { sdk } = sdkWith({ deposits: [], withdrawals: [] })
    expect(await sdk.user.getPendingRequests(OWNER)).toEqual([])
  })

  it('requires an owner', async () => {
    const { sdk } = sdkWith({ deposits: [], withdrawals: [] })
    await expect(sdk.user.getPendingRequests('')).rejects.toThrow(VaultSdkError)
  })
})
