import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  mintBorrowFeeCapPTB,
  removeUserBorrowFeeRatePTB,
  setAssetBorrowFeeRateBpsPTB,
  setBorrowFeeRateBpsPTB,
  setUserBorrowFeeRateBpsPTB
} from '../src/borrow-fee-admin'
import { getMoveCall, getObjectId, getPureValue, normalizeAddress, testConfig } from './helpers'

const borrowFeeCap = '0x2626262626262626262626262626262626262626262626262626262626262626'

describe('borrow-fee-admin', () => {
  it('mints borrow-fee caps with the storage admin cap', async () => {
    const tx = await mintBorrowFeeCapPTB({
      config: testConfig as any,
      recipient: '0x2727272727272727272727272727272727272727'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('mint_borrow_fee_cap')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.storageAdminCap)
    expect(getPureValue(tx, 1, bcs.Address)).toBe(
      normalizeAddress('0x2727272727272727272727272727272727272727')
    )
  })

  it('serializes default and asset borrow-fee bps setters against the provided cap', async () => {
    const tx = await setBorrowFeeRateBpsPTB({
      config: testConfig as any,
      borrowFeeCap,
      value: '125'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_borrow_fee_rate')
    expect(getObjectId(tx, 0)).toBe(borrowFeeCap)
    expect(String(getPureValue(tx, 2, bcs.u64()))).toBe('125')

    const assetTx = await setAssetBorrowFeeRateBpsPTB({
      config: testConfig as any,
      borrowFeeCap,
      assetId: 1,
      value: '225'
    })
    const assetMoveCall = getMoveCall(assetTx)

    expect(assetMoveCall.function).toBe('set_asset_borrow_fee_rate')
    expect(getPureValue(assetTx, 2, bcs.u8())).toBe(1)
    expect(String(getPureValue(assetTx, 3, bcs.u64()))).toBe('225')
  })

  it('serializes user-specific borrow-fee overrides and removals', async () => {
    const tx = await setUserBorrowFeeRateBpsPTB({
      config: testConfig as any,
      borrowFeeCap,
      user: '0x2828282828282828282828282828282828282828',
      assetId: 1,
      value: '350'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_user_borrow_fee_rate')
    expect(getPureValue(tx, 2, bcs.Address)).toBe(
      normalizeAddress('0x2828282828282828282828282828282828282828')
    )
    expect(getPureValue(tx, 3, bcs.u8())).toBe(1)
    expect(String(getPureValue(tx, 4, bcs.u64()))).toBe('350')

    const removeTx = await removeUserBorrowFeeRatePTB({
      config: testConfig as any,
      borrowFeeCap,
      user: '0x2828282828282828282828282828282828282828',
      assetId: 1
    })
    const removeMoveCall = getMoveCall(removeTx)

    expect(removeMoveCall.function).toBe('remove_incentive_v3_user_borrow_fee_rate')
    expect(getPureValue(removeTx, 2, bcs.Address)).toBe(
      normalizeAddress('0x2828282828282828282828282828282828282828')
    )
    expect(getPureValue(removeTx, 3, bcs.u8())).toBe(1)
  })
})
