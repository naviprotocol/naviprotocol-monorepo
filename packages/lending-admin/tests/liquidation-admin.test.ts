import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  setDesignatedLiquidatorPTB,
  setProtectedLiquidationUserPTB
} from '../src/liquidation-admin'
import { getMoveCall, getObjectId, getPureValue, normalizeAddress, testConfig } from './helpers'

describe('liquidation-admin', () => {
  it('sets designated liquidators with the storage owner cap', async () => {
    const tx = await setDesignatedLiquidatorPTB({
      config: testConfig as any,
      liquidator: '0x2929292929292929292929292929292929292929',
      user: '0x3030303030303030303030303030303030303030',
      isDesignated: true
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_designated_liquidators')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.ownerCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
    expect(getPureValue(tx, 2, bcs.Address)).toBe(
      normalizeAddress('0x2929292929292929292929292929292929292929')
    )
    expect(getPureValue(tx, 3, bcs.Address)).toBe(
      normalizeAddress('0x3030303030303030303030303030303030303030')
    )
    expect(getPureValue(tx, 4, bcs.Bool)).toBe(true)
  })

  it('marks protected liquidation users with the storage owner cap', async () => {
    const tx = await setProtectedLiquidationUserPTB({
      config: testConfig as any,
      user: '0x3131313131313131313131313131313131313131',
      isProtected: true
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_protected_liquidation_users')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.ownerCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
    expect(getPureValue(tx, 2, bcs.Address)).toBe(
      normalizeAddress('0x3131313131313131313131313131313131313131')
    )
    expect(getPureValue(tx, 3, bcs.Bool)).toBe(true)
  })
})
