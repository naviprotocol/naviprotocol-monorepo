import { describe, expect, it } from 'vitest'
import { checkDepositAmount, checkVaultAccepts } from '../../src/preflight'
import { isVaultSdkError } from '../../src/error'
import type { Vault } from '../../src/types'

function vault(overrides: Partial<Vault> = {}): Vault {
  return {
    id: '0x1',
    source: 'volo',
    protocol: 'volo',
    name: 'test vault',
    riskLevel: null,
    status: 'open',
    apy: { avg7d: null, avg30d: null, instant: null, target: null },
    assets: { baseCoin: { coinType: '0x2::sui::SUI', decimals: 9, symbol: 'SUI' } },
    totalStaked: null,
    totalStakedUsd: null,
    totalShares: null,
    exchangeRate: null,
    coinPrice: null,
    minInvestment: null,
    stakeCapAmount: null,
    lockup: null,
    volo: { package: '0xv', rewardManager: '0xrm', statusRecord: '0xsr' },
    ...overrides
  }
}

function codeOf(run: () => void) {
  try {
    run()
    return undefined
  } catch (error) {
    return isVaultSdkError(error)
      ? { code: error.code, details: error.details }
      : { code: 'non-sdk' }
  }
}

describe('checkVaultAccepts', () => {
  it('rejects both operations on a locked vault, which aborts 5022 on chain', () => {
    const locked = vault({ status: 'lock' })
    expect(codeOf(() => checkVaultAccepts(locked, 'deposit'))?.code).toBe('VAULT_NOT_OPEN')
    expect(codeOf(() => checkVaultAccepts(locked, 'withdraw'))).toMatchObject({
      code: 'VAULT_NOT_OPEN',
      details: { status: 'lock', operation: 'withdraw' }
    })
  })

  it('leaves statuses it does not know to the chain', () => {
    for (const status of ['open', 'OPEN', 'end', 'something-new', null]) {
      expect(codeOf(() => checkVaultAccepts(vault({ status }), 'withdraw'))).toBeUndefined()
    }
  })
})

describe('checkDepositAmount', () => {
  it('rejects a deposit below minInvestment, in the coin decimals', () => {
    const v = vault({ minInvestment: 1.5 })
    expect(codeOf(() => checkDepositAmount(v, 1_499_999_999n))).toMatchObject({
      code: 'DEPOSIT_BELOW_MINIMUM',
      details: { minimum: '1500000000' }
    })
    expect(codeOf(() => checkDepositAmount(v, 1_500_000_000n))).toBeUndefined()
  })

  it('rejects a deposit past the remaining cap headroom', () => {
    const v = vault({ stakeCapAmount: 100, totalStaked: 99.5 })
    expect(codeOf(() => checkDepositAmount(v, 600_000_000n))).toMatchObject({
      code: 'DEPOSIT_CAP_EXCEEDED',
      details: { headroom: '500000000' }
    })
    expect(codeOf(() => checkDepositAmount(v, 500_000_000n))).toBeUndefined()
  })

  it('treats a full vault as zero headroom rather than negative', () => {
    const v = vault({ stakeCapAmount: 100, totalStaked: 120 })
    expect(codeOf(() => checkDepositAmount(v, 1n))).toMatchObject({
      code: 'DEPOSIT_CAP_EXCEEDED',
      details: { headroom: '0' }
    })
  })

  it('enforces nothing the API did not report', () => {
    expect(codeOf(() => checkDepositAmount(vault(), 1n))).toBeUndefined()
    // A vault with a cap but no staked figure cannot be priced against it.
    expect(
      codeOf(() =>
        checkDepositAmount(vault({ stakeCapAmount: 100, totalStaked: null }), 10n ** 30n)
      )
    ).toBeUndefined()
  })
})
