import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { createProtocolRegistry, VaultSdkError } from '../src'
import {
  CERT,
  OWNER,
  RECEIPT,
  clientWithReceipts,
  offlineTransport,
  voloReward,
  voloStable
} from './fixtures'

function registry(receipts: string[] = []) {
  return createProtocolRegistry({
    client: clientWithReceipts(receipts, {}, voloStable().id),
    env: 'prod',
    options: {},
    transport: offlineTransport()
  })['volo-vault']
}

/** Volo's original published package, as read back from chain. */
const VOLO_ORIGINAL_PACKAGE = '0xcd86f77503a755c48fe6c87e1b8e9a137ec0c1bf37aac8878b6083262b27fefa'

type MoveCall = { function: string; typeArguments: string[]; arguments: unknown[] }

function moveCalls(tx: Transaction): MoveCall[] {
  return (tx.getData().commands as { MoveCall?: MoveCall }[])
    .filter((command) => command.MoveCall)
    .map((command) => command.MoveCall!)
}

describe('depositPTB', () => {
  it('records a request — no market sync, no harvest', async () => {
    // Volo is eventual: nothing settles here, so none of NAVI's freshness prologue applies.
    const tx = new Transaction()
    await registry().depositPTB(tx, voloStable(), OWNER, '10000000')
    expect(moveCalls(tx).map((call) => call.function)).toEqual(['none', 'deposit'])
  })

  it('passes deposit arguments in the contract order', async () => {
    const tx = new Transaction()
    await registry().depositPTB(tx, voloStable(), OWNER, '10000000')
    const deposit = moveCalls(tx).find((call) => call.function === 'deposit')!
    // (vault, reward_manager, coin, amount, expected_shares, receipt_opt, clock)
    expect(deposit.arguments).toHaveLength(7)
    expect(deposit.typeArguments).toEqual([voloStable().assets.base.coinType])
  })

  it('types the receipt option by the ORIGINAL package and the receipt module', async () => {
    const vault = voloStable()
    const tx = new Transaction()
    await registry().depositPTB(tx, vault, OWNER, '10000000')
    const option = moveCalls(tx).find((call) => call.function === 'none')!
    expect(option.typeArguments).toEqual([`${VOLO_ORIGINAL_PACKAGE}::receipt::Receipt`])
  })

  it('tops up an existing receipt instead of minting a second one', async () => {
    const tx = new Transaction()
    await registry([RECEIPT]).depositPTB(tx, voloStable(), OWNER, '10000000')
    expect(moveCalls(tx).map((call) => call.function)).toContain('some')
  })
})

describe('withdrawPTB', () => {
  it('takes shares and records a request', async () => {
    const tx = new Transaction()
    await registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, {
      kind: 'shares',
      shares: '1000'
    })
    const withdraw = moveCalls(tx).find((call) => call.function === 'withdraw')!
    // (vault, shares, expected_amount, receipt, clock)
    expect(withdraw.arguments).toHaveLength(5)
  })

  it('rejects an asset-denominated target', async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, {
        kind: 'amount',
        amount: '10000000'
      })
    ).rejects.toThrow(/takes shares/)
  })

  it("rejects 'all', which needs the settled balance", async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, { kind: 'all' })
    ).rejects.toThrow(/settled share balance/)
  })

  it('records the request without touching a queued deposit', async () => {
    // request_withdraw accepts PENDING_DEPOSIT_STATUS, so a queued deposit does not have
    // to be cancelled first. Cancelling is a separate call the caller composes.
    const tx = new Transaction()
    await registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, { kind: 'shares', shares: '1' })
    expect(moveCalls(tx).map((call) => call.function)).toEqual(['withdraw'])
  })
})

describe('cancellation — the operations NAVI Lending lacks', () => {
  it.each(['cancel_deposit', 'cancel_withdraw'] as const)(
    '%s takes (vault, receipt, requestId, clock)',
    async (fn) => {
      const method = fn === 'cancel_deposit' ? 'cancelDepositPTB' : 'cancelWithdrawPTB'
      const tx = new Transaction()
      await registry()[method](tx, voloStable(), OWNER, '7', RECEIPT)
      const call = moveCalls(tx)[0]!
      expect(call.function).toBe(fn)
      expect(call.arguments).toHaveLength(4)
    }
  )
})

describe('claimRewardsPTB', () => {
  it('claims through the RewardManager with no harvest step', async () => {
    const tx = new Transaction()
    await registry().claimRewardsPTB(tx, voloStable(), OWNER, [voloReward()])
    const calls = moveCalls(tx)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.function).toBe('claim_reward')
    // (reward_manager, vault, clock, receipt)
    expect(calls[0]!.arguments).toHaveLength(4)
    expect(calls[0]!.typeArguments).toEqual([voloStable().assets.base.coinType, CERT])
  })

  it('refuses an empty selection', async () => {
    const tx = new Transaction()
    await expect(registry().claimRewardsPTB(tx, voloStable(), OWNER, [])).rejects.toThrow(
      VaultSdkError
    )
  })
})
