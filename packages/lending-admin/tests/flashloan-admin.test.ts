import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  createFlashLoanAssetPTB,
  createFlashLoanConfigPTB,
  setFlashLoanAssetRateToSupplierBpsPTB,
  setFlashLoanAssetMinPTB
} from '../src/flashloan-admin'

const config = {
  lending: {
    package: '0x1111111111111111111111111111111111111111111111111111111111111111',
    storage: '0x2222222222222222222222222222222222222222222222222222222222222222',
    incentiveV3: '0x3333333333333333333333333333333333333333333333333333333333333333',
    flashloanConfig: '0x4444444444444444444444444444444444444444444444444444444444444444',
    poolAdminCap: '0x5555555555555555555555555555555555555555555555555555555555555555',
    storageAdminCap: '0x6666666666666666666666666666666666666666666666666666666666666666',
    ownerCap: '0x7777777777777777777777777777777777777777777777777777777777777777',
    incentiveOwnerCap: '0x8888888888888888888888888888888888888888888888888888888888888888'
  },
  oracle: {
    packageId: '0x9999999999999999999999999999999999999999999999999999999999999999',
    priceOracle: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    oracleAdminCap: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    oracleFeederCap: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    oracleConfig: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    pythStateId: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    wormholeStateId: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    supraOracleHolder: '0x1010101010101010101010101010101010101010101010101010101010101010',
    sender: '0x1212121212121212121212121212121212121212121212121212121212121212',
    gasObject: '0x1313131313131313131313131313131313131313131313131313131313131313',
    switchboardAggregator: '0x1414141414141414141414141414141414141414141414141414141414141414',
    feeds: []
  },
  reserveMetadata: [
    {
      assetId: 1,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      symbol: 'USDC',
      poolId: 10,
      pool: '0x1515151515151515151515151515151515151515151515151515151515151515',
      market: 'main'
    }
  ],
  market: {
    id: 0,
    key: 'main',
    name: 'Main Market'
  },
  version: 2
} as const

function getMoveCall(tx: Awaited<ReturnType<typeof createFlashLoanConfigPTB>>, commandIndex = 0) {
  const moveCall = tx.getData().commands[commandIndex]
  if (!moveCall || moveCall.$kind !== 'MoveCall') {
    throw new Error('Expected a MoveCall command')
  }
  return moveCall.MoveCall
}

function getPureValue(
  tx: Awaited<ReturnType<typeof createFlashLoanConfigPTB>>,
  inputIndex: number,
  parser: any
) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'Pure') {
    throw new Error(`Expected pure input ${inputIndex}`)
  }

  return parser.parse(Buffer.from(input.Pure.bytes, 'base64'))
}

function getObjectId(tx: Awaited<ReturnType<typeof createFlashLoanConfigPTB>>, inputIndex: number) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'UnresolvedObject') {
    throw new Error(`Expected object input ${inputIndex}`)
  }

  return input.UnresolvedObject.objectId
}

describe('flashloan-admin', () => {
  it('creates flashloan config using storage admin cap and storage object', async () => {
    const tx = await createFlashLoanConfigPTB({ config: config as any })
    const moveCall = getMoveCall(tx)

    expect(moveCall.package).toBe(config.lending.package)
    expect(moveCall.module).toBe('manage')
    expect(moveCall.function).toBe('create_flash_loan_config_with_storage')
    expect(getObjectId(tx, 0)).toBe(config.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.lending.storage)
  })

  it('serializes flashloan asset creation with atomic max and min values', async () => {
    const tx = await createFlashLoanAssetPTB({
      config: config as any,
      assetId: 1,
      rateToSupplierBps: '800',
      rateToTreasuryBps: '200',
      maximum: { value: '250', unit: 'token' },
      minimum: { value: '1.5', unit: 'token' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.package).toBe(config.lending.package)
    expect(moveCall.module).toBe('manage')
    expect(moveCall.function).toBe('create_flash_loan_asset')
    expect(moveCall.typeArguments).toEqual([config.reserveMetadata[0].coinType])
    expect(getObjectId(tx, 0)).toBe(config.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.lending.flashloanConfig)
    expect(getObjectId(tx, 2)).toBe(config.lending.storage)
    expect(getObjectId(tx, 3)).toBe(config.reserveMetadata[0].pool)
    expect(getPureValue(tx, 4, bcs.u8())).toBe(1)
    expect(String(getPureValue(tx, 5, bcs.u64()))).toBe('800')
    expect(String(getPureValue(tx, 6, bcs.u64()))).toBe('200')
    expect(String(getPureValue(tx, 7, bcs.u64()))).toBe('250000000')
    expect(String(getPureValue(tx, 8, bcs.u64()))).toBe('1500000')
  })

  it('serializes flashloan minimum setters with reserve decimals', async () => {
    const tx = await setFlashLoanAssetMinPTB({
      config: config as any,
      assetId: 1,
      value: { value: '1.5', unit: 'token' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_flash_loan_asset_min')
    expect(moveCall.typeArguments).toEqual([config.reserveMetadata[0].coinType])
    expect(String(getPureValue(tx, 2, bcs.u64()))).toBe('1500000')
  })

  it('serializes flashloan rate setters in explicit bps units', async () => {
    const tx = await setFlashLoanAssetRateToSupplierBpsPTB({
      config: config as any,
      assetId: 1,
      value: '800'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_flash_loan_asset_rate_to_supplier')
    expect(moveCall.typeArguments).toEqual([config.reserveMetadata[0].coinType])
    expect(String(getPureValue(tx, 2, bcs.u64()))).toBe('800')
  })
})
