import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  createNewMarketPTB,
  initBorrowWeightForMainMarketPTB,
  initFieldsBatchPTB,
  initForMainMarketPTB,
  removeBorrowWeightPTB,
  setBorrowWeightBpsPTB
} from '../src/market-admin'
import { getMoveCall, getObjectId, getPureValue, testConfig } from './helpers'

describe('market-admin', () => {
  it('creates new markets from the configured storage object', async () => {
    const tx = await createNewMarketPTB({ config: testConfig as any })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('create_new_market')
    expect(getObjectId(tx, 0)).toBe(testConfig.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(testConfig.lending.storage)
  })

  it('initializes market-level fields with the owner and admin caps', async () => {
    const fieldsTx = await initFieldsBatchPTB({ config: testConfig as any })
    expect(getMoveCall(fieldsTx).function).toBe('init_fields_batch')
    expect(getObjectId(fieldsTx, 0)).toBe(testConfig.lending.ownerCap)
    expect(getObjectId(fieldsTx, 1)).toBe(testConfig.lending.storage)
    expect(getObjectId(fieldsTx, 2)).toBe(testConfig.lending.incentiveV3)

    const mainTx = await initForMainMarketPTB({ config: testConfig as any })
    expect(getMoveCall(mainTx).function).toBe('init_for_main_market')

    const borrowWeightTx = await initBorrowWeightForMainMarketPTB({ config: testConfig as any })
    expect(getMoveCall(borrowWeightTx).function).toBe('init_borrow_weight_for_main_market')
  })

  it('serializes borrow-weight setters and removals in basis points', async () => {
    const tx = await setBorrowWeightBpsPTB({
      config: testConfig as any,
      assetId: 1,
      value: '12500'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_borrow_weight')
    expect(getPureValue(tx, 2, bcs.u8())).toBe(1)
    expect(String(getPureValue(tx, 3, bcs.u64()))).toBe('12500')

    const removeTx = await removeBorrowWeightPTB({
      config: testConfig as any,
      assetId: 1
    })
    const removeCall = getMoveCall(removeTx)

    expect(removeCall.function).toBe('remove_borrow_weight')
    expect(getPureValue(removeTx, 2, bcs.u8())).toBe(1)
  })
})
