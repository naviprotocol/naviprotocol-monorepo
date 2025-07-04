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

export type UserLendingInfo = {
  assetId: number
  borrowBalance: string
  supplyBalance: string
}

export type LendingReward = {
  assetId: number
  rewardType: number
  rewards: { coinType: string; available: string }[]
}

export type HistoryClaimedReward = {
  amount: string
  coinType: string
  pool: string
  sender: string
  timestamp: string
  tokenPrice: number
}

export type LendingClaimedReward = {}

export type Transaction = {
  type: string
  status: string
  coinChanges: {
    symbol: string
    amount: string
  }[]
  timestamp: string
  digest: string
}

export type Pool = {
  borrowCapCeiling: string
  coinType: string
  suiCoinType: string
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
  token: {
    coinType: string
    decimals: number
    logoURI: string
    symbol: string
  }
  contract: {
    reserveId: string
    pool: string
  }
}

export type AssetIdentifier = string | Pool | number

export type PoolOperator = 'deposit' | 'withdraw' | 'borrow' | 'repay'

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

export type OraclePriceFeed = {
  oracleId: number
  feedId: string
  assetId: number
  pythPriceInfoObject: string
  coinType: string
  priceDecimal: number
}

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
  oracle: {
    packageId: string
    priceOracle: string
    oracleAdminCap: string
    oracleConfig: string
    pythStateId: string
    wormholeStateId: string
    supraOracleHolder: string
    sender: string
    gasObject: string
    feeds: OraclePriceFeed[]
  }
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
