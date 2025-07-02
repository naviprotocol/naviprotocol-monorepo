import { type SuiClient } from '@mysten/sui/client'

export type EnvOption = {
  env: 'dev' | 'prod'
}

export type SuiClientOption = {
  client: SuiClient
}

export type CacheOption = {
  disableCache?: boolean
  cacheTime?: number
}

export type UserLendingInfo = {}

export type LendingReward = {}

export type HistoryReward = {}

export type LendingClaimedReward = {}

export type Transaction = {}

export type Pool = {
  borrowCapCeiling: string
  coinType: string
  currentBorrowIndex: string
  currentBorrowRate: string
  currentSupplyIndex: string
  currentSupplyRate: string
  id: number
  isIsolated: boolean
  lastUpdateTimestamp: string
  ltv: string
  oracleId: number
  supplyCapCeiling: string
  treasuryBalance: string
  treasuryFactor: string
  totalSupplyAmount: string
  minimumAmount: string
  leftSupply: string
  validBorrowAmount: string
  borrowedAmount: string
  leftBorrowAmount: string
  availableBorrow: string
  oracle: {
    decimal: 8
    value: string
    price: string
    oracleId: number
    valid: boolean
  }
  totalSupply: string
  totalBorrow: string
  borrowRateFactors: {
    fields: {
      baseRate: string
      multiplier: string
      jumpRateMultiplier: string
      optimalUtilization: string
      reserveFactor: string
    }
  }
  liquidationFactor: {
    bonus: string
    ratio: string
    threshold: string
  }
  supplyIncentiveApyInfo: {
    vaultApr: string
    boostedApr: string
    rewardCoin: string[]
    apy: string
    voloApy: string
    stakingYieldApy: string
    treasuryApy: string
  }
  borrowIncentiveApyInfo: {
    vaultApr: string
    boostedApr: string
    rewardCoin: string[]
    apy: string
    voloApy: string
    stakingYieldApy: string
    treasuryApy: string
  }
}

export type AssetIdentifier = string | Pool | number

export type PoolOperator = {}

export type FloashloanAsset = {
  max: string
  min: string
  assetId: number
  poolId: string
  supplierFee: number
  flashloanFee: number
  coinType: string
}

export type PoolStats = {
  tvl: number
  totalBorrowUsd: number
  averageUtilization: number
  maxApy: number
  userAmount: number
  interactionUserAmount: number
  borrowFee: number
  borrowFeeAddress: string
}

export type OraclePriceFeed = {}

export type LendingConfig = {
  package: string
  storage: string
  incentiveV2: string
  incentiveV3: string
  priceOracle: string
  uiGetter: string
  reserveParentId: string
  flashloanConfig: string
  flashloanSupportedAssets: string
}

export type FeeDetail = {
  coinId: string
  coinSymbol: string
  coinType: string
  feeObjectId: string
  currentAmount: number
  price: number
  currentValue: number
}
