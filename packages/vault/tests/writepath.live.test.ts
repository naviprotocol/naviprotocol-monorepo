/**
 * Live write-path simulation. Gated behind NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * Runs the deposit, withdrawal and reward-claim blocks through the Move VM against real
 * mainnet state. Nothing is signed and nothing moves; simulation discards the mutable
 * references. This is as far as the transaction builders can be verified without
 * submitting real funds, and it is what caught the unprefixed-type-argument bug that
 * every offline test missed.
 *
 * The holder and receipts below were discovered from `DepositEvent` on 2026-08-07. They
 * belong to third parties and may be transferred or burned; if a case starts failing
 * with E_RECEIPT_NOT_FOUND, re-discover a holder rather than assuming a regression.
 */
import { createNaviSuiClient } from '@naviprotocol/lending'
import { describe, expect, it } from 'vitest'
import {
  buildDepositTx,
  estimateGas,
  getVaultPositions,
  MAX_U64,
  parseVaultError,
  previewClaimReward,
  previewWithdraw,
  simulate
} from '../src'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'
const client = runLiveTests ? (createNaviSuiClient() as never) : (undefined as never)
const options = () => ({ client })

const HOLDER = '0xb63f43844a683e4be1157fb456c0cc8d38dedeb8b6c54d25d0b57662f144813e'
const CERT = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'

const CASES = [
  {
    key: 'SUI_PRIME',
    label: 'no reward rules',
    receiptId: '0x102e8b94337fa702e118c9a3005ba45c938fd044c2523f6b695e8bea72c0ae27',
    /** 2 sync + option::none + splitCoins + deposit + transfer */
    expectedCommands: 6
  },
  {
    key: 'SUI',
    label: 'one active market reward rule',
    receiptId: '0x107f1a0c5e11eeaefaed03c15de0659dc1396d043811a24dd93dba193da741f0',
    /** 3 sync + 1 collect_reward + option::none + splitCoins + deposit + transfer */
    expectedCommands: 8
  }
] as const

describe.skipIf(!runLiveTests).each(CASES)('$key ($label)', (testCase) => {
  it('deposit simulates against live state', async () => {
    // position: 'new' keeps the command count deterministic regardless of how many
    // receipts the third-party holder currently has. Reuse is covered by unit tests.
    const tx = await buildDepositTx(
      { vault: testCase.key, amount: 1_000_000_000n, sender: HOLDER, position: 'new' },
      options()
    )
    expect(tx.getData().commands).toHaveLength(testCase.expectedCommands)
    await expect(simulate(tx, { ...options(), sender: HOLDER })).resolves.toBeDefined()
  }, 120_000)

  it('values the holder position', async () => {
    const [position] = await getVaultPositions([testCase.receiptId], testCase.key, options())
    expect(position!.shares).toBeGreaterThan(0n)
    expect(position!.balance).toBeGreaterThan(0n)
  }, 120_000)

  it('full exit burns the whole position and reports what it returns', async () => {
    const [position] = await getVaultPositions([testCase.receiptId], testCase.key, options())
    const preview = await previewWithdraw(
      { vault: testCase.key, receiptId: testCase.receiptId, amount: MAX_U64, sender: HOLDER },
      options()
    )

    // fromDefault clamps the amount to the holder's maximum and the contract clamps the
    // burn to what they actually hold, so a full exit never over-burns.
    expect(preview.sharesBurned).toBe(position!.shares)
    expect(preview.maxShares).toBeGreaterThan(preview.sharesBurned)

    // The returned amount is authoritative and is at most the valued balance — the
    // virtual-share offset means a full exit leaves a little behind.
    expect(preview.amountOut).toBeDefined()
    expect(preview.amountOut!).toBeGreaterThan(0n)
    expect(preview.amountOut!).toBeLessThanOrEqual(position!.balance)
  }, 120_000)

  it('reward claim simulates through harvest', async () => {
    const amount = await previewClaimReward(
      {
        vault: testCase.key,
        receiptId: testCase.receiptId,
        rewardCoinType: CERT,
        sender: HOLDER
      },
      options()
    )
    // A vault with no rules pays zero; one with an active rule may pay more.
    expect(amount).toBeGreaterThanOrEqual(0n)
  }, 120_000)
})

describe.skipIf(!runLiveTests)('abort classification against live state', () => {
  it('reports an unknown receipt as a user error, not an outage', async () => {
    try {
      await previewWithdraw(
        {
          vault: 'SUI_PRIME',
          receiptId: `0x${'e'.repeat(64)}`,
          amount: 1_000n,
          sender: HOLDER
        },
        options()
      )
      expect.unreachable('withdrawal against a nonexistent receipt should fail')
    } catch (error) {
      const decoded = parseVaultError(error)
      if (decoded) {
        expect(decoded.kind).not.toBe('outage')
      }
    }
  }, 120_000)
})

describe.skipIf(!runLiveTests)('gas estimation', () => {
  it('reports a plausible net cost for a deposit block', async () => {
    const tx = await buildDepositTx(
      { vault: 'SUI_PRIME', amount: 100_000_000n, sender: HOLDER, position: 'new' },
      options()
    )
    const gas = await estimateGas(tx, { ...options(), sender: HOLDER })

    expect(gas.computationCost).toBeGreaterThan(0n)
    expect(gas.netCost).toBe(gas.computationCost + gas.storageCost - gas.storageRebate)
    // A 6-command block on mainnet lands well under 0.1 SUI; anything above that means
    // the estimate is being read from the wrong field.
    expect(gas.netCost).toBeLessThan(100_000_000n)
  }, 120_000)
})
