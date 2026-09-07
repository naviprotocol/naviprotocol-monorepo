import { describe, expect, it } from 'vitest'
import { getVaultRewards, navi } from '../../src'
import { client, getMainnetContext, positionData, report, runLiveTests } from './context'

describe.skipIf(!runLiveTests)('NAVI vault reads', () => {
  it('reads vault state, reward rules, and holder rewards', async () => {
    const { naviPosition } = getMainnetContext()
    const [info, rules, rewards] = await Promise.all([
      navi.getVaultInfo(naviPosition.vault, { client, disableCache: true }),
      navi.getVaultRewardRules(naviPosition.vault, { client }),
      getVaultRewards(naviPosition.vault, naviPosition.owner, { client })
    ])
    expect(BigInt(info.total_shares)).toBeGreaterThan(0n)
    expect(rules).toHaveLength(info.reward_rules.length)
    expect(Array.isArray(rewards)).toBe(true)
    report.add({
      api: 'navi.getVaultInfo / navi.getVaultRewardRules / getVaultRewards',
      title: 'Read NAVI vault state, reward rules, and holder rewards',
      status: 'passed',
      purpose:
        'Cross-check the SDK against live NAVI vault objects and reward data for the chain-derived holder.',
      data: {
        position: positionData(naviPosition),
        vaultInfo: info,
        rewardRules: rules,
        holderRewards: rewards
      },
      validations: [
        'The on-chain vault total_shares value is greater than zero.',
        'The parsed reward-rule count exactly matches the reward_rules table length in vault state.',
        'Holder rewards are returned as an array for the discovered wallet.'
      ]
    })
  })
})
