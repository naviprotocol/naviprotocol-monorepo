import type { TransactionResult as TransactionResultType } from '@mysten/sui/transactions'

export type TransactionResult =
  | {
      $kind: 'GasCoin'
      GasCoin: true
    }
  | {
      $kind: 'Input'
      Input: number
      type?: 'pure'
    }
  | {
      $kind: 'Input'
      Input: number
      type?: 'object'
    }
  | {
      $kind: 'Result'
      Result: number
    }
  | {
      $kind: 'NestedResult'
      NestedResult: [number, number]
    }
  | TransactionResultType

export type CoinObject =
  | TransactionResult
  | {
      $kind: 'GasCoin'
      GasCoin: true
    }
  | {
      $kind: 'Input'
      Input: number
      type?: 'object'
    }
  | string

export type BigintLike = string | number | bigint

export type EnvOption = {
  env: 'dev' | 'prod' | 'test'
}

export type MarketOption = {
  market: string
}

export type CacheOption = {
  disableCache?: boolean
  cacheTime?: number
}

export type AdminOracleConfig = {
  packageId: string
  priceOracle: string
  oracleAdminCap: string
  oracleConfig: string
  oracleFeederCap: string
}

export type AdminConfig = {
  package: string
  storage: string
  incentiveV2: string
  incentiveV3: string
  priceOracle: string
  flashloanConfig?: string
  storageAdminCap: string
  storageOwnerCap: string
  poolAdminCap: string
  incentiveOwner: string
  borrowFeeCap?: string
  suiPoolId?: string
  oracle: AdminOracleConfig
}

export type AdminConfigOption = {
  config?: AdminConfig
}

export type AdminOverrideOption = {
  storage?: string
  incentiveV3?: string
  incentiveV2?: string
  storageAdminCap?: string
  storageOwnerCap?: string
  poolAdminCap?: string
  incentiveOwner?: string
  borrowFeeCap?: string
  flashloanConfig?: string
  priceOracle?: string
  suiPoolId?: string
}

export type ResolveConfigOptions = Partial<
  EnvOption & MarketOption & CacheOption & AdminConfigOption & AdminOverrideOption
>

export type StorageAdminCapOption = {
  storageAdminCap: string
}

export type AssetRef = {
  pool: string
  id: number
}

export type AssetIdentifier = string | AssetRef

export type EmodeAssetInput = {
  assetId: number
  isCollateral: boolean
  isDebt: boolean
  ltv: BigintLike
  lt: BigintLike
  liquidationBonus: BigintLike
}

// Backward-compatible alias for common naming style.
export type EModeAssetInput = EmodeAssetInput

export type InitReserveParams = {
  coinType: string
  oracleId: number
  isIsolated?: boolean
  supplyCap: BigintLike
  borrowCap: BigintLike
  baseRate: BigintLike
  optimalUtilization: BigintLike
  multiplier: BigintLike
  jumpRate: BigintLike
  reserveFactor: BigintLike
  ltv: BigintLike
  treasuryFactor: BigintLike
  liquidationRatio: BigintLike
  liquidationBonus: BigintLike
  liquidationThreshold: BigintLike
  metadataObject: string
}

export type IncentiveRuleCreateParams = {
  assetType: string
  rewardType: string
  option: number
}

export type IncentiveRewardRateParams = {
  assetType: string
  ruleId: string
  supplyAmount: BigintLike
  supplyDuration: BigintLike
}

export type RewardFundPoolCreateParams = {
  rewardFundType: string
}

export type RewardFundDepositParams = {
  rewardFundType: string
  rewardFundId: string
  coin: CoinObject
  amount: BigintLike
}

export type RewardFundInitForMarketParams = {
  rewardFundType: string
  rewardFundId: string
}

export type RewardFundWithdrawParams = {
  fundType: string
  fundsObjectId: string
  value: BigintLike
}
