import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  createIncentiveV3PTB,
  createIncentiveV3PoolPTB,
  createIncentiveV3RewardFundPTB,
  setIncentiveV3MaxRewardRateByRuleIdPTB,
  setIncentiveV3RewardRateByRuleIdPTB,
  withdrawBorrowFeePTB
} from '../src/incentive-admin'
import { getMoveCall, getObjectId, getPureValue, normalizeAddress, testConfig } from './helpers'

describe('incentive-admin', () => {
  it('creates incentive v3 with the incentive owner cap and storage', async () => {
    const tx = await createIncentiveV3PTB({ config: testConfig as any })
    const moveCall = getMoveCall(tx)

    expect(moveCall.package).toBe(testConfig.lending.package)
    expect(moveCall.module).toBe('manage')
    expect(moveCall.function).toBe('create_incentive_v3_with_storage')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.incentiveOwnerCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
  })

  it('creates reward funds with the reward coin type and market storage', async () => {
    const tx = await createIncentiveV3RewardFundPTB({
      config: testConfig as any,
      coinType: testConfig.reserveMetadata[0].coinType
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('create_incentive_v3_reward_fund_with_storage')
    expect(moveCall.typeArguments).toEqual([testConfig.reserveMetadata[0].coinType])
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.incentiveOwnerCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
  })

  it('creates incentive pools with reserve selection', async () => {
    const poolTx = await createIncentiveV3PoolPTB({
      config: testConfig as any,
      assetId: 1
    })
    const poolCall = getMoveCall(poolTx)

    expect(poolCall.function).toBe('create_incentive_v3_pool')
    expect(poolCall.typeArguments).toEqual([testConfig.reserveMetadata[0].coinType])
    expect(getPureValue(poolTx, 3, bcs.u8())).toBe(1)
  })

  it('serializes reward-rate setters with reward coin decimals instead of reserve decimals', async () => {
    const tx = await setIncentiveV3RewardRateByRuleIdPTB({
      config: testConfig as any,
      assetId: 1,
      rewardCoinType: testConfig.reserveMetadata[1].coinType,
      ruleId: '0x2424242424242424242424242424242424242424',
      totalSupply: { value: '1.5', unit: 'token' },
      durationMs: '86400000'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_incentive_v3_reward_rate_by_rule_id')
    expect(getObjectId(tx, 1)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000006'
    )
    expect(String(getPureValue(tx, 5, bcs.u64()))).toBe('1500000000')
    expect(String(getPureValue(tx, 6, bcs.u64()))).toBe('86400000')
  })

  it('serializes max reward-rate setters with explicit reward decimals', async () => {
    const tx = await setIncentiveV3MaxRewardRateByRuleIdPTB({
      config: testConfig as any,
      assetId: 1,
      rewardDecimals: 8,
      ruleId: '0x2626262626262626262626262626262626262626',
      totalSupply: { value: '2.25', unit: 'token' },
      durationMs: '86400000'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_incentive_v3_max_reward_rate_by_rule_id')
    expect(String(getPureValue(tx, 3, bcs.u64()))).toBe('225000000')
    expect(String(getPureValue(tx, 4, bcs.u64()))).toBe('86400000')
  })

  it('rejects token reward-rate inputs without explicit reward token metadata', async () => {
    await expect(
      setIncentiveV3RewardRateByRuleIdPTB({
        config: testConfig as any,
        assetId: 1,
        ruleId: '0x2727272727272727272727272727272727272727',
        totalSupply: { value: '1.5', unit: 'token' },
        durationMs: '86400000'
      })
    ).rejects.toThrow('token reward totalSupply requires rewardCoinType or rewardDecimals')
  })

  it('converts borrow-fee withdrawals to atomic reserve amounts', async () => {
    const tx = await withdrawBorrowFeePTB({
      config: testConfig as any,
      coinType: testConfig.reserveMetadata[0].coinType,
      amount: { value: '2.75', unit: 'token' },
      recipient: '0x2525252525252525252525252525252525252525'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('withdraw_borrow_fee')
    expect(moveCall.typeArguments).toEqual([testConfig.reserveMetadata[0].coinType])
    expect(String(getPureValue(tx, 2, bcs.u64()))).toBe('2750000')
    expect(getPureValue(tx, 3, bcs.Address)).toBe(
      normalizeAddress('0x2525252525252525252525252525252525252525')
    )
  })
})
