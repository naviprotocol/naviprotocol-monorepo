import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  initReservePTB,
  initReserveRawPTB,
  setBaseRatePTB,
  setBaseRateRawPTB,
  setBorrowCapPTB,
  setSupplyCapPTB,
  versionMigrateStoragePTB,
  withdrawTreasuryPTB
} from '../src/reserve-admin'

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

function getMoveCall(tx: Awaited<ReturnType<typeof setBaseRatePTB>>) {
  const moveCall = tx.getData().commands[0]
  if (!moveCall || moveCall.$kind !== 'MoveCall') {
    throw new Error('Expected a MoveCall command')
  }
  return moveCall.MoveCall
}

function getPureValue(
  tx: Awaited<ReturnType<typeof setBaseRatePTB>>,
  inputIndex: number,
  parser: any
) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'Pure') {
    throw new Error(`Expected pure input ${inputIndex}`)
  }

  return parser.parse(Buffer.from(input.Pure.bytes, 'base64'))
}

function getObjectId(tx: Awaited<ReturnType<typeof setBaseRatePTB>>, inputIndex: number) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'UnresolvedObject') {
    throw new Error(`Expected object input ${inputIndex}`)
  }

  return input.UnresolvedObject.objectId
}

describe('reserve-admin', () => {
  it('serializes percent and ratio base rate inputs to the same ray value', async () => {
    const percentTx = await setBaseRatePTB({
      config: config as any,
      assetId: 1,
      value: { value: '4', unit: 'percent' }
    })
    const ratioTx = await setBaseRatePTB({
      config: config as any,
      assetId: 1,
      value: { value: '0.04', unit: 'ratio' }
    })
    const rawTx = await setBaseRateRawPTB({
      config: config as any,
      assetId: 1,
      value: '40000000000000000000000000'
    })

    const percentCall = getMoveCall(percentTx)
    expect(percentCall.package).toBe(config.lending.package)
    expect(percentCall.module).toBe('storage')
    expect(percentCall.function).toBe('set_base_rate')
    expect(getObjectId(percentTx, 0)).toBe(config.lending.ownerCap)
    expect(getObjectId(percentTx, 1)).toBe(config.lending.storage)
    expect(getPureValue(percentTx, 2, bcs.u8())).toBe(1)
    expect(String(getPureValue(percentTx, 3, bcs.u256()))).toBe('40000000000000000000000000')
    expect(String(getPureValue(ratioTx, 3, bcs.u256()))).toBe('40000000000000000000000000')
    expect(String(getPureValue(rawTx, 3, bcs.u256()))).toBe('40000000000000000000000000')
  })

  it('encodes withdraw treasury amounts with reserve decimals and injects system state', async () => {
    const tx = await withdrawTreasuryPTB({
      config: config as any,
      assetId: 1,
      amount: { value: '1.5', unit: 'token' },
      recipient: '0x1616161616161616161616161616161616161616161616161616161616161616'
    })

    const moveCall = getMoveCall(tx)
    expect(moveCall.package).toBe(config.lending.package)
    expect(moveCall.module).toBe('storage')
    expect(moveCall.function).toBe('withdraw_treasury_v2')
    expect(moveCall.typeArguments).toEqual([config.reserveMetadata[0].coinType])
    expect(getObjectId(tx, 0)).toBe(config.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.lending.poolAdminCap)
    expect(getObjectId(tx, 2)).toBe(config.lending.storage)
    expect(getPureValue(tx, 3, bcs.u8())).toBe(1)
    expect(getObjectId(tx, 4)).toBe(config.reserveMetadata[0].pool)
    expect(String(getPureValue(tx, 5, bcs.u64()))).toBe('1500000')
    expect(getObjectId(tx, 7)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000005'
    )
  })

  it('uses protocol-normalized amounts for supply caps and bounded rays for borrow caps', async () => {
    const supplyTx = await setSupplyCapPTB({
      config: config as any,
      assetId: 1,
      value: { value: '2', unit: 'token' }
    })
    const supplyCall = getMoveCall(supplyTx)

    expect(supplyCall.function).toBe('set_supply_cap')
    expect(String(getPureValue(supplyTx, 3, bcs.u256()))).toBe('2000000000')

    const borrowTx = await setBorrowCapPTB({
      config: config as any,
      assetId: 1,
      value: { value: '90', unit: 'percent' }
    })
    const borrowCall = getMoveCall(borrowTx)

    expect(borrowCall.function).toBe('set_borrow_cap')
    expect(String(getPureValue(borrowTx, 3, bcs.u256()))).toBe('900000000000000000000000000')
  })

  it('injects clock and admin caps into init reserve raw builders', async () => {
    const tx = await initReserveRawPTB({
      config: config as any,
      coinType: config.reserveMetadata[0].coinType,
      coinMetadata: '0x1717171717171717171717171717171717171717171717171717171717171717',
      oracleId: 9,
      supplyCap: '1',
      borrowCap: '2',
      baseRate: '3',
      optimalUtilization: '4',
      multiplier: '5',
      jumpRateMultiplier: '6',
      reserveFactor: '7',
      ltv: '8',
      treasuryFactor: '9',
      liquidationRatio: '10',
      liquidationBonus: '11',
      liquidationThreshold: '12'
    })

    const moveCall = getMoveCall(tx)
    expect(moveCall.package).toBe(config.lending.package)
    expect(moveCall.module).toBe('storage')
    expect(moveCall.function).toBe('init_reserve')
    expect(moveCall.typeArguments).toEqual([config.reserveMetadata[0].coinType])
    expect(getObjectId(tx, 0)).toBe(config.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.lending.poolAdminCap)
    expect(getObjectId(tx, 2)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000006'
    )
    expect(getObjectId(tx, 3)).toBe(config.lending.storage)
    expect(getPureValue(tx, 4, bcs.u8())).toBe(9)
    expect(String(getPureValue(tx, 6, bcs.u256()))).toBe('1')
    expect(getObjectId(tx, 18)).toBe(
      '0x1717171717171717171717171717171717171717171717171717171717171717'
    )
  })

  it('serializes safe reserve initialization with normalized supply caps and ray fields', async () => {
    const tx = await initReservePTB({
      config: config as any,
      coinType: config.reserveMetadata[0].coinType,
      coinMetadata: '0x1818181818181818181818181818181818181818181818181818181818181818',
      oracleId: 7,
      supplyCap: { value: '2', unit: 'token' },
      borrowCap: { value: '90', unit: 'percent' },
      baseRate: { value: '4', unit: 'percent' },
      optimalUtilization: { value: '80', unit: 'percent' },
      multiplier: { value: '0.5', unit: 'ratio' },
      jumpRateMultiplier: { value: '1.5', unit: 'ratio' },
      reserveFactor: { value: '10', unit: 'percent' },
      ltv: { value: '75', unit: 'percent' },
      treasuryFactor: { value: '5', unit: 'percent' },
      liquidationRatio: { value: '85', unit: 'percent' },
      liquidationBonus: { value: '10', unit: 'percent' },
      liquidationThreshold: { value: '80', unit: 'percent' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('init_reserve')
    expect(String(getPureValue(tx, 6, bcs.u256()))).toBe('2000000000')
    expect(String(getPureValue(tx, 7, bcs.u256()))).toBe('900000000000000000000000000')
    expect(String(getPureValue(tx, 8, bcs.u256()))).toBe('40000000000000000000000000')
  })

  it('version migrates storage with the storage admin cap', async () => {
    const tx = await versionMigrateStoragePTB({ config: config as any })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('version_migrate')
    expect(getObjectId(tx, 0)).toBe(config.lending.storageAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.lending.storage)
  })
})
