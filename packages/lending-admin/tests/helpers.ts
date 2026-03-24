import { bcs } from '@mysten/sui/bcs'

export const testConfig = {
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
  reserveMetadata: [
    {
      assetId: 1,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      symbol: 'USDC',
      poolId: 10,
      pool: '0x2121212121212121212121212121212121212121212121212121212121212121',
      market: 'main'
    },
    {
      assetId: 2,
      coinType: '0x2::sui::SUI',
      decimals: 9,
      symbol: 'SUI',
      poolId: 11,
      pool: '0x2222222222222222222222222222222222222222222222222222222222222211',
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

export function getMoveCall(tx: any, commandIndex = 0) {
  const moveCall = tx.getData().commands[commandIndex]
  if (!moveCall || moveCall.$kind !== 'MoveCall') {
    throw new Error('Expected a MoveCall command')
  }

  return moveCall.MoveCall
}

export function getPureValue(tx: any, inputIndex: number, parser: any) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'Pure') {
    throw new Error(`Expected pure input ${inputIndex}`)
  }

  return parser.parse(Buffer.from(input.Pure.bytes, 'base64'))
}

export function getObjectId(tx: any, inputIndex: number) {
  const input = tx.getData().inputs[inputIndex]
  if (!input || input.$kind !== 'UnresolvedObject') {
    throw new Error(`Expected object input ${inputIndex}`)
  }

  return input.UnresolvedObject.objectId
}

export function normalizeAddress(value: string) {
  const hex = value.toLowerCase().replace(/^0x/, '')
  return `0x${hex.padStart(64, '0')}`
}

export const validatorWeightsBcs = bcs.struct('VecMapAddressU64', {
  contents: bcs.vector(
    bcs.struct('EntryAddressU64', {
      key: bcs.Address,
      value: bcs.u64()
    })
  )
})
