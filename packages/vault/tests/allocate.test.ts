import { describe, expect, it } from 'vitest'
import { planWithdrawal, U64_MAX, VaultSdkError } from '../src'

const balances = (...entries: [string, bigint][]) =>
  entries.map(([receiptId, balance]) => ({ receiptId, balance }))

describe('planWithdrawal', () => {
  it('takes the whole amount from one receipt when it covers it', () => {
    expect(planWithdrawal(balances(['a', 1000n]), 400n)).toEqual([{ receiptId: 'a', amount: 400n }])
  })

  it('drains a fully consumed receipt with U64_MAX rather than its exact balance', () => {
    // Passing the balance verbatim would race the share price; U64_MAX lets the contract
    // clamp to whatever the holder actually has at execution time.
    expect(planWithdrawal(balances(['a', 400n], ['b', 1000n]), 1400n)).toEqual([
      { receiptId: 'b', amount: U64_MAX },
      { receiptId: 'a', amount: U64_MAX }
    ])
  })

  it('spills onto a second receipt and gives it the exact remainder', () => {
    expect(planWithdrawal(balances(['a', 1000n], ['b', 500n]), 1200n)).toEqual([
      { receiptId: 'a', amount: U64_MAX },
      { receiptId: 'b', amount: 200n }
    ])
  })

  it('orders by balance so the fewest receipts are touched', () => {
    const plan = planWithdrawal(balances(['small', 10n], ['big', 5000n]), 100n)
    expect(plan).toEqual([{ receiptId: 'big', amount: 100n }])
  })

  it('skips empty receipts entirely', () => {
    // A zero-share receipt is common: it is left behind by an earlier full exit.
    const plan = planWithdrawal(balances(['empty', 0n], ['funded', 500n]), 100n)
    expect(plan).toEqual([{ receiptId: 'funded', amount: 100n }])
  })

  it('drains every funded receipt for a full exit', () => {
    expect(planWithdrawal(balances(['a', 1n], ['b', 2n], ['empty', 0n]), U64_MAX)).toEqual([
      { receiptId: 'b', amount: U64_MAX },
      { receiptId: 'a', amount: U64_MAX }
    ])
  })

  it('refuses to build a plan that cannot cover the request', () => {
    expect(() => planWithdrawal(balances(['a', 100n]), 500n)).toThrow(/hold 100 in total/)
  })

  it('reports having nothing to withdraw', () => {
    expect(() => planWithdrawal(balances(['empty', 0n]), 1n)).toThrow(VaultSdkError)
  })
})

describe('planWithdrawal — empty holdings', () => {
  it.each([
    ['a full exit', U64_MAX],
    ['a fixed amount', 100n]
  ])('refuses %s when no receipt holds anything', (_label, amount) => {
    // The full-exit shortcut used to bypass this, handing back an empty plan — and with
    // it a transaction carrying the prologue but no withdrawal at all.
    expect(() => planWithdrawal([], amount)).toThrow(/hold a balance/)
    expect(() => planWithdrawal(balances(['empty', 0n]), amount)).toThrow(/hold a balance/)
  })
})
