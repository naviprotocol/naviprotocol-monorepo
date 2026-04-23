import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  createPriceFeedPTB,
  createSwitchboardOracleProviderConfigPTB,
  registerTokenPricePTB,
  setEnableToPriceFeedPTB,
  setMaximumEffectivePriceToPriceFeedPTB,
  setPrimaryOracleProviderPTB,
  updateTokenPriceBatchPTB
} from '../src/oracle-admin'

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
    feeds: [
      {
        oracleId: 1,
        assetId: 1,
        coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        feedId: '0x1515151515151515151515151515151515151515151515151515151515151515',
        pythPriceFeedId: '0x1616161616161616161616161616161616161616161616161616161616161616',
        pythPriceInfoObject: '0x1717171717171717171717171717171717171717171717171717171717171717',
        priceDecimal: 6,
        supraPairId: 47
      },
      {
        oracleId: 2,
        assetId: 2,
        coinType: '0x2::sui::SUI',
        feedId: '0x1818181818181818181818181818181818181818181818181818181818181818',
        pythPriceFeedId: '0x1919191919191919191919191919191919191919191919191919191919191919',
        pythPriceInfoObject: '0x1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a',
        priceDecimal: 9,
        supraPairId: 90
      }
    ]
  },
  reserveMetadata: [],
  market: {
    id: 0,
    key: 'main',
    name: 'Main Market'
  },
  version: 2
} as const

function getMoveCall(tx: Awaited<ReturnType<typeof registerTokenPricePTB>>, commandIndex = 0) {
  const moveCall = tx.getData().commands[commandIndex]
  if (!moveCall || moveCall.$kind !== 'MoveCall') {
    throw new Error('Expected a MoveCall command')
  }
  return moveCall.MoveCall
}

function getPureValue(
  tx: Awaited<ReturnType<typeof registerTokenPricePTB>>,
  inputIndex: number,
  parser: any
) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'Pure') {
    throw new Error(`Expected pure input ${inputIndex}`)
  }

  return parser.parse(Buffer.from(input.Pure.bytes, 'base64'))
}

function getObjectId(tx: Awaited<ReturnType<typeof registerTokenPricePTB>>, inputIndex: number) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'UnresolvedObject') {
    throw new Error(`Expected object input ${inputIndex}`)
  }

  return input.UnresolvedObject.objectId
}

describe('oracle-admin', () => {
  it('serializes register token price values with feed decimals and clock injection', async () => {
    const tx = await registerTokenPricePTB({
      config: config as any,
      oracleId: 1,
      value: { value: '1.23', unit: 'decimal' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.package).toBe(config.oracle.packageId)
    expect(moveCall.module).toBe('oracle')
    expect(moveCall.function).toBe('register_token_price')
    expect(getObjectId(tx, 0)).toBe(config.oracle.oracleAdminCap)
    expect(getObjectId(tx, 1)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000006'
    )
    expect(getObjectId(tx, 2)).toBe(config.oracle.priceOracle)
    expect(getPureValue(tx, 3, bcs.u8())).toBe(1)
    expect(String(getPureValue(tx, 4, bcs.u256()))).toBe('1230000')
    expect(getPureValue(tx, 5, bcs.u8())).toBe(6)
  })

  it('serializes oracle price batch updates as vectors of oracle ids and atomic prices', async () => {
    const tx = await updateTokenPriceBatchPTB({
      config: config as any,
      updates: [
        { oracleId: 1, value: { value: '1.23', unit: 'decimal' } },
        { oracleId: 2, value: { value: '4.5', unit: 'decimal' } }
      ]
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('update_token_price_batch')
    expect(getObjectId(tx, 0)).toBe(config.oracle.oracleFeederCap)
    expect(getObjectId(tx, 1)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000006'
    )
    expect(getObjectId(tx, 2)).toBe(config.oracle.priceOracle)
    expect(Array.from(getPureValue(tx, 3, bcs.vector(bcs.u8())))).toEqual([1, 2])
    expect(Array.from(getPureValue(tx, 4, bcs.vector(bcs.u256()))).map(String)).toEqual([
      '1230000',
      '4500000000'
    ])
  })

  it('serializes effective price setters using feed decimals', async () => {
    const tx = await setMaximumEffectivePriceToPriceFeedPTB({
      config: config as any,
      feedId: config.oracle.feeds[0].feedId,
      value: { value: '1.23', unit: 'decimal' }
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('set_maximum_effective_price_to_price_feed')
    expect(getObjectId(tx, 0)).toBe(config.oracle.oracleAdminCap)
    expect(getObjectId(tx, 1)).toBe(config.oracle.oracleConfig)
    expect(String(getPureValue(tx, 3, bcs.u256()))).toBe('1230000')
  })

  it('creates price feeds with explicit decimal inputs before the feed exists', async () => {
    const tx = await createPriceFeedPTB({
      config: config as any,
      coinType: config.oracle.feeds[0].coinType,
      oracleId: 3,
      maxTimestampDiff: '5000',
      priceDiffThreshold1: '10',
      priceDiffThreshold2: '20',
      maxDurationWithinThresholds: '3000',
      maximumAllowedSpanPercentage: '50',
      maximumEffectivePrice: { value: '2.5', unit: 'decimal', decimals: 6 },
      minimumEffectivePrice: { value: '1.5', unit: 'decimal', decimals: 6 },
      historicalPriceTTL: '60000'
    })
    const moveCall = getMoveCall(tx)

    expect(moveCall.function).toBe('create_price_feed')
    expect(moveCall.typeArguments).toEqual([config.oracle.feeds[0].coinType])
    expect(getPureValue(tx, 2, bcs.u8())).toBe(3)
    expect(String(getPureValue(tx, 8, bcs.u256()))).toBe('2500000')
    expect(String(getPureValue(tx, 9, bcs.u256()))).toBe('1500000')
  })

  it('serializes feed toggles and switchboard provider config vectors', async () => {
    const toggleTx = await setEnableToPriceFeedPTB({
      config: config as any,
      feedId: config.oracle.feeds[0].feedId,
      value: true
    })
    const toggleCall = getMoveCall(toggleTx)

    expect(toggleCall.function).toBe('set_enable_to_price_feed')
    expect(getPureValue(toggleTx, 3, bcs.Bool)).toBe(true)

    const switchboardTx = await createSwitchboardOracleProviderConfigPTB({
      config: config as any,
      feedId: config.oracle.feeds[0].feedId,
      pairId: [1, 2, 3, 4],
      enable: true
    })
    const switchboardCall = getMoveCall(switchboardTx)

    expect(switchboardCall.function).toBe('create_switchboard_oracle_provider_config')
    expect(Array.from(getPureValue(switchboardTx, 3, bcs.vector(bcs.u8())))).toEqual([1, 2, 3, 4])
    expect(getPureValue(switchboardTx, 4, bcs.Bool)).toBe(true)
  })

  it('builds provider selection with an intermediate provider move call', async () => {
    const tx = await setPrimaryOracleProviderPTB({
      config: config as any,
      feedId: config.oracle.feeds[0].feedId,
      provider: 'pyth'
    })

    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('pyth_provider')
    expect(getMoveCall(tx, 1).function).toBe('set_primary_oracle_provider')
  })
})
