import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { createProtocolRegistry, VaultSdkError } from '../src'
import { CERT, OWNER, RECEIPT, USDT, clientWithReceipts, voloReward, voloStable } from './fixtures'

function registry(receipts: string[] = []) {
  return createProtocolRegistry({
    client: clientWithReceipts(receipts, {}, voloStable().id),
    env: 'prod',
    options: {}
  })['volo-vault']
}

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
    await registry().depositPTB(tx, voloStable(), OWNER, '10')
    expect(moveCalls(tx).map((call) => call.function)).toEqual(['none', 'deposit'])
  })

  it('passes deposit arguments in the contract order', async () => {
    const tx = new Transaction()
    await registry().depositPTB(tx, voloStable(), OWNER, '10')
    const deposit = moveCalls(tx).find((call) => call.function === 'deposit')!
    // (vault, reward_manager, coin, amount, expected_shares, receipt_opt, clock)
    expect(deposit.arguments).toHaveLength(7)
    expect(deposit.typeArguments).toEqual([voloStable().assets.base.coinType])
  })

  it('types the receipt option by the ORIGINAL package and the receipt module', async () => {
    const vault = voloStable()
    const tx = new Transaction()
    await registry().depositPTB(tx, vault, OWNER, '10')
    const option = moveCalls(tx).find((call) => call.function === 'none')!
    expect(option.typeArguments).toEqual([
      `${vault.contractConfig.initialPackageId}::receipt::Receipt`
    ])
  })

  it('tops up an existing receipt instead of minting a second one', async () => {
    const tx = new Transaction()
    await registry([RECEIPT]).depositPTB(tx, voloStable(), OWNER, '10')
    expect(moveCalls(tx).map((call) => call.function)).toContain('some')
  })

  it('rejects a coin the vault does not accept, and lists what it takes', async () => {
    const tx = new Transaction()
    await expect(
      registry().depositPTB(tx, voloStable(), OWNER, '10', { coinType: '0x2::sui::SUI' })
    ).rejects.toThrow(/does not accept/)
  })

  it('fails when the vault has no RewardManager configured', async () => {
    const vault = voloStable()
    const broken = {
      ...vault,
      contractConfig: {
        ...vault.contractConfig,
        volo: { ...vault.contractConfig.volo, rewardManagerObjectId: undefined }
      }
    }
    const tx = new Transaction()
    await expect(registry().depositPTB(tx, broken, OWNER, '10')).rejects.toThrow(/RewardManager/)
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
      registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, { kind: 'amount', amount: '10' })
    ).rejects.toThrow(/takes shares/)
  })

  it("rejects 'all', which needs the settled balance", async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT]).withdrawPTB(tx, voloStable(), OWNER, { kind: 'all' })
    ).rejects.toThrow(/settled share balance/)
  })

  it('cancels the queued deposit before withdrawing, in one block', async () => {
    // The contract's assert_normal refuses a withdrawal while a deposit is still queued,
    // so the cancel has to land first — the backend does the same in one transaction.
    const tx = new Transaction()
    await registry([RECEIPT]).withdrawPTB(
      tx,
      voloStable(),
      OWNER,
      { kind: 'shares', shares: '1' },
      { cancelPendingDeposit: true, pendingDepositRequestId: '42' }
    )
    expect(moveCalls(tx).map((call) => call.function)).toEqual(['cancel_deposit', 'withdraw'])
  })

  it('asks for the request id when told to cancel', async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT]).withdrawPTB(
        tx,
        voloStable(),
        OWNER,
        { kind: 'shares', shares: '1' },
        { cancelPendingDeposit: true }
      )
    ).rejects.toThrow(/getPendingRequests/)
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
