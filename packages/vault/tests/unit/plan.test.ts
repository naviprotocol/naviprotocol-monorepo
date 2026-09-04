import { describe, expect, it } from 'vitest'
import { U64_MAX } from '../../src/config'
import {
  planReceiptWithdrawByAmount,
  type VaultReceipt as NaviReceipt
} from '../../src/protocols/navi/receipt'
import {
  RECEIPT_STATUS,
  canRequestDeposit,
  canRequestWithdraw,
  planReceiptWithdraw,
  type VaultReceipt as VoloReceipt
} from '../../src/protocols/volo/receipt'

function naviReceipt(id: string, shares: bigint): NaviReceipt {
  return { id, shares, rewards: [] }
}

function voloReceipt(
  id: string,
  shares: bigint,
  status = RECEIPT_STATUS.NORMAL as number
): VoloReceipt {
  return { id, shares, status, pendingWithdrawShares: 0n, lastDepositTime: 0 }
}

describe('navi planReceiptWithdrawByAmount', () => {
  // 1:1 asset/share rate keeps the arithmetic readable.
  const totalAssets = 1_000n
  const totalShares = 1_000n
  const receipts = [
    naviReceipt('big', 100n),
    naviReceipt('small', 10n),
    naviReceipt('mid', 50n),
    naviReceipt('empty', 0n)
  ]

  it('drains every non-empty receipt with the U64_MAX sentinel for withdraw-all', () => {
    const { plans, shortfall } = planReceiptWithdrawByAmount(
      receipts,
      U64_MAX,
      totalAssets,
      totalShares
    )
    expect(plans.map((plan) => plan.id)).toEqual(['small', 'mid', 'big'])
    expect(plans.every((plan) => plan.amount === U64_MAX)).toBe(true)
    expect(shortfall).toBe(0n)
  })

  it('consumes smallest-first, draining full receipts and sizing only the last one', () => {
    const partial = planReceiptWithdrawByAmount(receipts, 55n, totalAssets, totalShares)
    expect(partial.plans).toEqual([
      { id: 'small', amount: U64_MAX },
      { id: 'mid', amount: 45n }
    ])
    expect(partial.shortfall).toBe(0n)

    // An exact cover drains the last receipt with the sentinel as well.
    const exact = planReceiptWithdrawByAmount(receipts, 60n, totalAssets, totalShares)
    expect(exact.plans).toEqual([
      { id: 'small', amount: U64_MAX },
      { id: 'mid', amount: U64_MAX }
    ])
    expect(exact.shortfall).toBe(0n)
  })

  it('reports the uncovered remainder as shortfall', () => {
    const { plans, shortfall } = planReceiptWithdrawByAmount(
      receipts,
      1_000n,
      totalAssets,
      totalShares
    )
    expect(plans).toHaveLength(3)
    expect(shortfall).toBe(840n)
  })

  it('values receipts at the floored on-chain rate', () => {
    // 3 shares at 10 assets / 4 shares = 7.5 -> 7
    const { plans, shortfall } = planReceiptWithdrawByAmount([naviReceipt('r', 3n)], 7n, 10n, 4n)
    expect(plans).toEqual([{ id: 'r', amount: U64_MAX }])
    expect(shortfall).toBe(0n)
  })
})

describe('volo planReceiptWithdraw', () => {
  const receipts = [
    voloReceipt('big', 100n),
    voloReceipt('small', 10n),
    voloReceipt('mid', 50n),
    voloReceipt('empty', 0n)
  ]

  it('consumes smallest-first and overwrites shares on the partial receipt', () => {
    const { plans, shortfall } = planReceiptWithdraw(receipts, 55n)
    expect(plans.map((plan) => [plan.id, plan.shares])).toEqual([
      ['small', 10n],
      ['mid', 45n]
    ])
    expect(shortfall).toBe(0n)
  })

  it('never plans a zero-share call and reports the shortfall', () => {
    const { plans, shortfall } = planReceiptWithdraw(receipts, 500n)
    expect(plans.map((plan) => plan.id)).toEqual(['small', 'mid', 'big'])
    expect(plans.every((plan) => plan.shares > 0n)).toBe(true)
    expect(shortfall).toBe(340n)
  })
})

describe('volo receipt status gates mirror volo_vault.move', () => {
  // request_deposit: NORMAL | PENDING_WITHDRAW | PENDING_WITHDRAW_WITH_AUTO_TRANSFER, else 5017
  // request_withdraw: NORMAL | PENDING_DEPOSIT, else 5017
  it.each([
    [RECEIPT_STATUS.NORMAL, true, true],
    [RECEIPT_STATUS.PENDING_DEPOSIT, false, true],
    [RECEIPT_STATUS.PENDING_WITHDRAW, true, false],
    [RECEIPT_STATUS.PENDING_WITHDRAW_WITH_AUTO_TRANSFER, true, false],
    [RECEIPT_STATUS.PARALLEL_PENDING_DEPOSIT_WITHDRAW, false, false],
    [RECEIPT_STATUS.PARALLEL_PENDING_DEPOSIT_WITHDRAW_WITH_AUTO_TRANSFER, false, false]
  ])('status %i: canRequestDeposit=%s canRequestWithdraw=%s', (status, deposit, withdraw) => {
    expect(canRequestDeposit({ status })).toBe(deposit)
    expect(canRequestWithdraw({ status })).toBe(withdraw)
  })
})
