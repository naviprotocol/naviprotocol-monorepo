import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { claimRewardsPTB, getVaultRewards } from '../../src'
import {
  client,
  dryRun,
  dryRunData,
  getMainnetContext,
  report,
  requireBalanceChange,
  runLiveTests,
  SUI,
  vaultEventType
} from './context'

describe.skipIf(!runLiveTests)('claimRewardsPTB', () => {
  it('dry-runs NAVI reward claims for the chain-derived holder', async () => {
    const { naviPosition } = getMainnetContext()
    const rewards = await getVaultRewards(naviPosition.vault, naviPosition.owner, { client })
    const tx = new Transaction()
    const coins = await claimRewardsPTB(tx, rewards, { client })
    for (const { coin } of coins) tx.transferObjects([coin], naviPosition.owner)
    const result = await dryRun(tx, naviPosition.owner)
    const claimEvents = result.events?.filter(
      (event) => event.eventType === vaultEventType('navi', 'ClaimRewardEvent')
    )
    expect(claimEvents?.length).toBeGreaterThan(0)

    const claimedByCoin = new Map<string, bigint>()
    for (const event of claimEvents ?? []) {
      expect(event.json?.vault).toBe(naviPosition.vault.id)
      expect(event.json?.sender).toBe(naviPosition.owner)
      expect(BigInt(String(event.json?.amount))).toBeGreaterThan(0n)
      const coinType = normalizeStructTag(String(event.json?.reward_coin_type))
      claimedByCoin.set(
        coinType,
        (claimedByCoin.get(coinType) ?? 0n) + BigInt(String(event.json?.amount))
      )
    }

    for (const [coinType, amount] of claimedByCoin) {
      const balanceChange = requireBalanceChange(result, naviPosition.owner, coinType)
      if (coinType === SUI) {
        expect(BigInt(balanceChange.amount)).toBeLessThan(amount)
      } else {
        expect(BigInt(balanceChange.amount)).toBe(amount)
      }
    }

    const output = dryRunData(result)
    report.add({
      api: 'claimRewardsPTB',
      title: 'Dry-run NAVI reward claims',
      status: 'passed',
      purpose:
        'Simulate claims for live claimable rewards and reconcile emitted reward amounts against owner balance changes by coin type.',
      data: {
        sender: naviPosition.owner,
        vault: naviPosition.vault,
        receiptId: naviPosition.receiptId,
        inputRewards: rewards,
        claimedByCoin: Array.from(claimedByCoin, ([coinType, amount]) => ({ coinType, amount })),
        effectsStatus: output.effectsStatus
      },
      validations: [
        'At least one ClaimRewardEvent is emitted.',
        `Every claim event identifies vault=${naviPosition.vault.id} and sender=${naviPosition.owner}.`,
        'Every emitted claim amount is greater than zero.',
        'For each non-SUI reward coin, the owner balance increase exactly equals the sum of emitted claim amounts.',
        'For a SUI reward coin, the owner balance increase is below the claim sum only by simulated gas cost.'
      ],
      events: output.events,
      balanceChanges: output.balanceChanges
    })
  }, 180_000)
})
