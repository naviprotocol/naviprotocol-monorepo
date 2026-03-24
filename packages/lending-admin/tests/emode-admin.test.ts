import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  createEmodeAssetPTB,
  createEmodePairPTB,
  initEmodeForMainMarketPTB,
  setEmodeAssetLtvPTB
} from '../src/emode-admin'
import { getMoveCall, getObjectId, getPureValue, testConfig } from './helpers'

describe('emode-admin', () => {
  it('initializes emode fields for the main market storage', async () => {
    const tx = await initEmodeForMainMarketPTB({ config: testConfig as any })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('init_emode_for_main_market')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
  })

  it('serializes emode asset creation with bounded ray rates', async () => {
    const { tx } = await createEmodeAssetPTB({
      config: testConfig as any,
      assetId: 1,
      isCollateral: true,
      isDebt: true,
      ltv: { value: '75', unit: 'percent' },
      lt: { value: '0.8', unit: 'ratio' },
      liquidationBonus: { value: '5', unit: 'percent' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('create_emode_asset')
    expect(getPureValue(tx, 1, bcs.u8())).toBe(1)
    expect(String(getPureValue(tx, 4, bcs.u256()))).toBe('750000000000000000000000000')
    expect(String(getPureValue(tx, 5, bcs.u256()))).toBe('800000000000000000000000000')
    expect(String(getPureValue(tx, 6, bcs.u256()))).toBe('50000000000000000000000000')
  })

  it('creates emode pairs and setter calls on the storage object', async () => {
    const tx = await createEmodePairPTB({
      config: testConfig as any,
      assetA: {
        assetId: 1,
        isCollateral: true,
        isDebt: false,
        ltv: { value: '75', unit: 'percent' },
        lt: { value: '80', unit: 'percent' },
        liquidationBonus: { value: '5', unit: 'percent' }
      },
      assetB: {
        assetId: 2,
        isCollateral: true,
        isDebt: true,
        ltv: { value: '0.7', unit: 'ratio' },
        lt: { value: '0.8', unit: 'ratio' },
        liquidationBonus: { value: '0.06', unit: 'ratio' }
      }
    })

    expect(tx.getData().commands).toHaveLength(3)
    expect(getMoveCall(tx, 0).function).toBe('create_emode_asset')
    expect(getMoveCall(tx, 1).function).toBe('create_emode_asset')
    expect(getMoveCall(tx, 2).function).toBe('create_emode_pair')

    const setterTx = await setEmodeAssetLtvPTB({
      config: testConfig as any,
      emodeId: '7',
      assetId: 1,
      value: { value: '75', unit: 'percent' }
    })
    const setterCall = getMoveCall(setterTx)

    expect(setterCall.function).toBe('set_emode_asset_ltv')
    expect(String(getPureValue(setterTx, 2, bcs.u64()))).toBe('7')
    expect(getPureValue(setterTx, 3, bcs.u8())).toBe(1)
    expect(String(getPureValue(setterTx, 4, bcs.u256()))).toBe('750000000000000000000000000')
  })
})
