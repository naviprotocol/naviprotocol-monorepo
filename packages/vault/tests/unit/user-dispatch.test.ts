import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vault } from '../../src/types'

vi.mock('../../src/vault', () => ({
  getVault: vi.fn(async (vault: Vault) => vault)
}))
vi.mock('../../src/protocols/navi', () => ({
  depositPTB: vi.fn(),
  withdrawPTB: vi.fn(),
  getVaultRewards: vi.fn(),
  claimRewardsPTB: vi.fn()
}))
vi.mock('../../src/protocols/volo', () => ({
  depositPTB: vi.fn(),
  withdrawPTB: vi.fn()
}))

import { depositPTB, withdrawPTB } from '../../src/user'
import * as navi from '../../src/protocols/navi'
import * as volo from '../../src/protocols/volo'
import { isVaultSdkError } from '../../src/error'

const OWNER = '0x000000000000000000000000000000000000000000000000000000000000abcd'

function vault(source: 'navi' | 'volo', decimals = 9): Vault {
  return {
    id: `0x${source === 'navi' ? '1' : '2'}`,
    source,
    protocol: source,
    name: `${source} vault`,
    riskLevel: null,
    status: 'open',
    apy: { avg7d: null, avg30d: null, instant: null, target: null },
    assets: { baseCoin: { coinType: '0x2::sui::SUI', decimals, symbol: 'SUI' } },
    totalStaked: null,
    totalStakedUsd: null,
    totalShares: null,
    exchangeRate: null,
    coinPrice: null,
    minInvestment: null,
    stakeCapAmount: null,
    lockup: null,
    ...(source === 'navi'
      ? { navi: { package: '0xn' } }
      : { volo: { package: '0xv', rewardManager: '0xrm', statusRecord: '0xsr' } })
  }
}

function fakeTx() {
  return {
    transferObjects: vi.fn(),
    pure: { address: vi.fn((address: string) => address) }
  } as unknown as import('@mysten/sui/transactions').Transaction
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return isVaultSdkError(error) ? error.code : `non-sdk-error:${String(error)}`
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('top-level depositPTB dispatch', () => {
  it('parses the human amount and hands NAVI its receipt to transfer', async () => {
    const tx = fakeTx()
    vi.mocked(navi.depositPTB).mockResolvedValue(['NAVI_RECEIPT', 'SHARES'] as never)

    const result = await depositPTB(tx, vault('navi'), OWNER, '1.5', { useGasCoin: true })

    expect(navi.depositPTB).toHaveBeenCalledWith(tx, vault('navi'), OWNER, 1_500_000_000n, {
      useGasCoin: true
    })
    expect(tx.transferObjects).toHaveBeenCalledWith(['NAVI_RECEIPT'], OWNER)
    expect(result).toEqual({ receipt: 'NAVI_RECEIPT', shares: 'SHARES' })
    expect(volo.depositPTB).not.toHaveBeenCalled()
  })

  it('returns the VOLO receipt and request id, transferring receipt and change to owner', async () => {
    // Regression: the Volo branch used to return the NAVI case's `naviReceipt` binding,
    // which threw a ReferenceError (temporal dead zone) on every Volo deposit.
    const tx = fakeTx()
    vi.mocked(volo.depositPTB).mockResolvedValue(['REQUEST_ID', 'VOLO_RECEIPT', 'CHANGE'] as never)

    const result = await depositPTB(tx, vault('volo', 6), OWNER, '2.25')

    expect(volo.depositPTB).toHaveBeenCalledWith(tx, vault('volo', 6), OWNER, 2_250_000n, undefined)
    expect(tx.transferObjects).toHaveBeenCalledWith(['VOLO_RECEIPT', 'CHANGE'], OWNER)
    expect(result).toEqual({ receipt: 'VOLO_RECEIPT', requestId: 'REQUEST_ID' })
    expect(navi.depositPTB).not.toHaveBeenCalled()
  })

  it('rejects a bad amount before calling any builder', async () => {
    const tx = fakeTx()
    expect(await codeOf(depositPTB(tx, vault('navi'), OWNER, '0'))).toBe('INVALID_AMOUNT')
    expect(await codeOf(depositPTB(tx, vault('volo'), OWNER, '1.0000000001'))).toBe(
      'INVALID_AMOUNT'
    )
    expect(navi.depositPTB).not.toHaveBeenCalled()
    expect(volo.depositPTB).not.toHaveBeenCalled()
    expect(tx.transferObjects).not.toHaveBeenCalled()
  })
})

describe('top-level withdrawPTB dispatch', () => {
  it('normalizes human amounts and share strings before dispatching', async () => {
    const tx = fakeTx()
    vi.mocked(navi.withdrawPTB).mockResolvedValue('COIN' as never)
    vi.mocked(volo.withdrawPTB).mockResolvedValue(['REQ'] as never)

    await withdrawPTB(tx, vault('navi'), OWNER, { kind: 'amount', amount: '1.5' })
    expect(navi.withdrawPTB).toHaveBeenLastCalledWith(
      tx,
      vault('navi'),
      OWNER,
      { kind: 'amount', amount: 1_500_000_000n },
      undefined
    )

    await withdrawPTB(tx, vault('volo'), OWNER, { kind: 'shares', shares: '42' })
    expect(volo.withdrawPTB).toHaveBeenLastCalledWith(
      tx,
      vault('volo'),
      OWNER,
      { kind: 'shares', shares: 42n },
      undefined
    )

    await withdrawPTB(tx, vault('volo'), OWNER, { kind: 'all' })
    expect(volo.withdrawPTB).toHaveBeenLastCalledWith(
      tx,
      vault('volo'),
      OWNER,
      { kind: 'all' },
      undefined
    )
  })
})
