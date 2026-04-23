import { bcs } from '@mysten/sui/bcs'
import type { DevInspectResults } from '@mysten/sui/client'

import { UserStateInfo } from '../src/bcs'
import type { EMode, FloashloanAsset, LendingConfig, Pool } from '../src/types'

const RAY = '1000000000000000000000000000'

export const testObjectId = (value: number) => `0x${value.toString(16).padStart(64, '0')}`

export const TEST_ADDRESS = testObjectId(1)
export const TEST_ACCOUNT_CAP = testObjectId(2)

export const TEST_EMODE: EMode = {
  emodeId: 1,
  marketId: 0,
  isActive: true,
  uniqueId: 'main-1',
  assets: [
    {
      assetId: 0,
      ltv: 0.75,
      lt: 0.8,
      bonus: 0.05,
      isCollateral: true,
      isDebt: false
    },
    {
      assetId: 1,
      ltv: 0,
      lt: 0,
      bonus: 0,
      isCollateral: false,
      isDebt: true
    }
  ]
}

export const TEST_CONFIG = {
  package: testObjectId(3),
  storage: testObjectId(4),
  incentiveV2: testObjectId(5),
  incentiveV3: testObjectId(6),
  priceOracle: testObjectId(7),
  uiGetter: testObjectId(8),
  reserveParentId: testObjectId(9),
  flashloanConfig: testObjectId(10),
  flashloanSupportedAssets: testObjectId(11),
  version: 2,
  oracle: {
    packageId: testObjectId(12),
    priceOracle: testObjectId(13),
    oracleAdminCap: testObjectId(14),
    oracleConfig: testObjectId(15),
    pythStateId: testObjectId(16),
    wormholeStateId: testObjectId(17),
    supraOracleHolder: testObjectId(18),
    sender: TEST_ADDRESS,
    gasObject: testObjectId(19),
    feeds: [],
    switchboardAggregator: testObjectId(20)
  },
  emode: {
    contract: {
      registryPackage: testObjectId(21),
      registryObject: testObjectId(22)
    }
  }
} as LendingConfig

export const TEST_FLASHLOAN_ASSET: FloashloanAsset = {
  assetId: 0,
  poolId: testObjectId(23),
  coinType: '0x2::sui::SUI',
  flashloanFee: 0.001,
  supplierFee: 0.0005,
  max: '100000000000',
  min: '1000'
}

export function createPoolFixture(overrides: Partial<Pool> = {}): Pool {
  const basePool = {
    uniqueId: 'main-0',
    borrowCapCeiling: '0',
    coinType: '0x2::sui::SUI',
    suiCoinType: '0x2::sui::SUI',
    currentBorrowIndex: RAY,
    currentBorrowRate: '0',
    currentSupplyIndex: RAY,
    currentSupplyRate: '0',
    id: 0,
    isIsolated: false,
    lastUpdateTimestamp: '0',
    ltv: '0.75',
    ltvValue: 0.75,
    oracleId: 0,
    supplyCapCeiling: '0',
    treasuryBalance: '0',
    treasuryFactor: '0',
    totalSupplyAmount: '1000000000',
    minimumAmount: '0',
    leftSupply: '0',
    validBorrowAmount: '1000000000',
    borrowedAmount: '100000000',
    leftBorrowAmount: '0',
    availableBorrow: '100000000',
    oracle: {
      decimal: 9,
      value: '1000000000',
      price: '1',
      oracleId: 0,
      valid: true
    },
    totalSupply: '1000000000',
    totalBorrow: '100000000',
    borrowRateFactors: {
      fields: {
        baseRate: '0',
        multiplier: '0',
        jumpRateMultiplier: '0',
        optimalUtilization: '0',
        reserveFactor: '0'
      }
    },
    liquidationFactor: {
      bonus: '0',
      ratio: '0',
      threshold: '0'
    },
    supplyIncentiveApyInfo: {
      vaultApr: '0',
      boostedApr: '0',
      rewardCoin: [],
      apy: '0',
      voloApy: '0',
      stakingYieldApy: '0',
      treasuryApy: '0'
    },
    borrowIncentiveApyInfo: {
      vaultApr: '0',
      boostedApr: '0',
      rewardCoin: [],
      apy: '0',
      voloApy: '0',
      stakingYieldApy: '0',
      treasuryApy: '0'
    },
    token: {
      coinType: '0x2::sui::SUI',
      decimals: 9,
      logoUri: '',
      symbol: 'SUI',
      price: 1
    },
    contract: {
      reserveId: testObjectId(24),
      pool: testObjectId(25)
    },
    isDeprecated: false,
    isSuiBridge: false,
    isLayerZero: false,
    isWormhole: false,
    status: 'active' as const,
    tags: [],
    market: 'main',
    emodes: [TEST_EMODE],
    poolSupplyAmount: '1',
    poolSupplyValue: '1',
    poolSupplyCapAmount: '10',
    poolSupplyCapValue: '10',
    poolBorrowAmount: '0.1',
    poolBorrowValue: '0.1',
    poolBorrowCapAmount: '1',
    poolBorrowCapValue: '1',
    balance: '1000000000'
  } satisfies Pool

  return {
    ...basePool,
    ...overrides,
    oracle: {
      ...basePool.oracle,
      ...(overrides.oracle || {})
    },
    borrowRateFactors: {
      fields: {
        ...basePool.borrowRateFactors.fields,
        ...(overrides.borrowRateFactors?.fields || {})
      }
    },
    liquidationFactor: {
      ...basePool.liquidationFactor,
      ...(overrides.liquidationFactor || {})
    },
    supplyIncentiveApyInfo: {
      ...basePool.supplyIncentiveApyInfo,
      ...(overrides.supplyIncentiveApyInfo || {})
    },
    borrowIncentiveApyInfo: {
      ...basePool.borrowIncentiveApyInfo,
      ...(overrides.borrowIncentiveApyInfo || {})
    },
    token: {
      ...basePool.token,
      ...(overrides.token || {})
    },
    contract: {
      ...basePool.contract,
      ...(overrides.contract || {})
    },
    emodes: overrides.emodes || basePool.emodes
  }
}

export function encodeU256(value: string | number | bigint): Uint8Array {
  return bcs.u256().serialize(value.toString()).toBytes()
}

export function encodeU64Vector(values: Array<string | number | bigint>): Uint8Array {
  return bcs
    .vector(bcs.u64())
    .serialize(values.map((value) => BigInt(value)))
    .toBytes()
}

export function encodeAddressVector(values: string[]): Uint8Array {
  return bcs.vector(bcs.Address).serialize(values).toBytes()
}

export function encodeUserStates(
  states: Array<{
    asset_id: number
    borrow_balance: string | number | bigint
    supply_balance: string | number | bigint
  }>
): Uint8Array {
  return bcs
    .vector(UserStateInfo as any)
    .serialize(
      states.map((state) => ({
        ...state,
        borrow_balance: state.borrow_balance.toString(),
        supply_balance: state.supply_balance.toString()
      }))
    )
    .toBytes()
}

export function devInspectResultFromBytes(...values: Uint8Array[]): DevInspectResults {
  return {
    results: [
      {
        returnValues: values.map((value) => [Array.from(value), ''])
      }
    ]
  } as DevInspectResults
}
