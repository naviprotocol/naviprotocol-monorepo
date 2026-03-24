import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  directDepositSuiPTB,
  initPoolForMainMarketPTB,
  initSuiPoolManagerPTB,
  refreshSuiStakePTB,
  setTargetSuiAmountPTB,
  setValidatorWeightsVsuiPTB,
  withdrawPoolTreasuryPTB
} from '../src/pool-admin'
import {
  getMoveCall,
  getObjectId,
  getPureValue,
  normalizeAddress,
  testConfig,
  validatorWeightsBcs
} from './helpers'

describe('pool-admin', () => {
  it('initializes existing pools for the main market by reserve selection', async () => {
    const tx = await initPoolForMainMarketPTB({
      config: testConfig as any,
      assetId: 1
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('init_pool_for_main_market')
    expect(moveCall.typeArguments).toEqual([testConfig.reserveMetadata[0].coinType])
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.poolAdminCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.reserveMetadata[0].pool)
  })

  it('serializes generic pool treasury withdrawals with reserve decimals', async () => {
    const tx = await withdrawPoolTreasuryPTB({
      config: testConfig as any,
      assetId: 1,
      amount: { value: '1.5', unit: 'token' },
      recipient: '0x3232323232323232323232323232323232323232'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('withdraw_treasury')
    expect(moveCall.typeArguments).toEqual([testConfig.reserveMetadata[0].coinType])
    expect(String(getPureValue(tx, 2, bcs.u64()))).toBe('1500000')
    expect(getPureValue(tx, 3, bcs.Address)).toBe(
      normalizeAddress('0x3232323232323232323232323232323232323232')
    )
  })

  it('initializes and retargets the sui pool manager with atomic sui amounts', async () => {
    const tx = await initSuiPoolManagerPTB({
      config: testConfig as any,
      stakePool: '0x3333333333333333333333333333333333333333333333333333333333333333',
      metadata: '0x3434343434343434343434343434343434343434343434343434343434343434',
      targetSuiAmount: { value: '1.5', unit: 'token' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('init_sui_pool_manager')
    expect(getObjectId(tx, 1)).toBe(testConfig.reserveMetadata[1].pool)
    expect(String(getPureValue(tx, 4, bcs.u64()))).toBe('1500000000')

    const targetTx = await setTargetSuiAmountPTB({
      config: testConfig as any,
      targetSuiAmount: { value: '2', unit: 'token' }
    })
    const targetCall = getMoveCall(targetTx)

    expect(targetCall.function).toBe('set_target_sui_amount')
    expect(String(getPureValue(targetTx, 2, bcs.u64()))).toBe('2000000000')
    expect(getObjectId(targetTx, 3)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000005'
    )
  })

  it('serializes sui pool-manager refresh, validator weights, and direct deposits', async () => {
    const refreshTx = await refreshSuiStakePTB({ config: testConfig as any })
    expect(getMoveCall(refreshTx).function).toBe('refresh_stake')
    expect(getObjectId(refreshTx, 0)).toBe(testConfig.reserveMetadata[1].pool)
    expect(getObjectId(refreshTx, 1)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000005'
    )

    const validatorTx = await setValidatorWeightsVsuiPTB({
      config: testConfig as any,
      vsuiOperatorCap: '0x3535353535353535353535353535353535353535353535353535353535353535',
      validatorWeights: [
        {
          validator: '0x3636363636363636363636363636363636363636',
          weight: '7000'
        },
        {
          validator: '0x3737373737373737373737373737373737373737',
          weight: '3000'
        }
      ]
    })
    const validatorCall = getMoveCall(validatorTx)

    expect(validatorCall.function).toBe('set_validator_weights_vsui')
    expect(getObjectId(validatorTx, 2)).toBe(
      '0x3535353535353535353535353535353535353535353535353535353535353535'
    )
    expect(
      validatorWeightsBcs.parse(Buffer.from(validatorTx.getData().inputs[3].Pure.bytes, 'base64'))
    ).toEqual({
      contents: [
        {
          key: normalizeAddress('0x3636363636363636363636363636363636363636'),
          value: '7000'
        },
        {
          key: normalizeAddress('0x3737373737373737373737373737373737373737'),
          value: '3000'
        }
      ]
    })

    const depositTx = await directDepositSuiPTB({
      config: testConfig as any,
      suiCoin: '0x3838383838383838383838383838383838383838383838383838383838383838'
    })
    const depositCall = getMoveCall(depositTx)

    expect(depositCall.function).toBe('direct_deposit_sui')
    expect(getObjectId(depositTx, 0)).toBe(testConfig.lending.poolAdminCap)
    expect(getObjectId(depositTx, 1)).toBe(testConfig.reserveMetadata[1].pool)
    expect(getObjectId(depositTx, 2)).toBe(
      '0x3838383838383838383838383838383838383838383838383838383838383838'
    )
  })
})
