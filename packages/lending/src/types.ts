/**
 * Lending Protocol Type Definitions
 *
 * This module contains comprehensive type definitions for the lending protocol,
 * including user information, pool data, rewards, transactions, and configuration.
 *
 * @module LendingTypes
 */

import type { SuiClient } from '@mysten/sui/client'
import type { TransactionResult as TransactionResultType } from '@mysten/sui/transactions'

/**
 * Union type for transaction results from Sui blockchain
 *
 * This type represents various forms of transaction results including
 * direct results, nested results, and standard transaction result types.
 */
export type TransactionResult =
  | {
      $kind: 'Result'
      Result: number
    }
  | {
      $kind: 'NestedResult'
      NestedResult: [number, number]
    }
  | TransactionResultType

export type AccountCap = string

/**
 * Environment configuration options
 */
export type EnvOption = {
  /** Environment setting: 'dev' for development, 'prod' for production */
  env: 'dev' | 'prod'
}

/**
 * Account capability options for lending operations
 */
export type AccountCapOption = {
  /** Account capability object ID or transaction result */
  accountCap: string | TransactionResult
}

/**
 * Sui client configuration options
 */
export type SuiClientOption = {
  /** Sui client instance */
  client: SuiClient
}

/**
 * Caching configuration options
 */
export type CacheOption = {
  /** Whether to disable caching for this operation */
  disableCache?: boolean
  /** Cache expiration time in milliseconds */
  cacheTime?: number
}

/**
 * User lending information for a specific asset
 */
export type UserLendingInfo = {
  /** Asset identifier */
  assetId: number
  /** Current borrow balance */
  borrowBalance: string
  /** Current supply balance */
  supplyBalance: string
  /** Pool information */
  pool: Pool
}

/**
 * Lending reward information for a user
 */
export type LendingReward = {
  /** Amount of reward available to claim */
  userClaimableReward: number
  /** Amount of reward already claimed */
  userClaimedReward?: string
  /** Reward option identifier */
  option: number
  /** Array of rule IDs for this reward */
  ruleIds: string[]
  /** Asset coin type */
  assetCoinType: string
  /** Reward coin type */
  rewardCoinType: string
  /** Asset identifier */
  assetId: number
}

/**
 * Summary of lending rewards for an asset
 */
export type LendingRewardSummary = {
  /** Asset identifier */
  assetId: number
  /** Type of reward */
  rewardType: number
  /** Available rewards by coin type */
  rewards: { coinType: string; available: string }[]
}

/**
 * Historical record of claimed rewards
 */
export type HistoryClaimedReward = {
  /** Amount claimed */
  amount: string
  /** Coin type of the reward */
  coinType: string
  /** Pool identifier */
  pool: string
  /** User address who claimed */
  sender: string
  /** Timestamp of claim */
  timestamp: string
  /** Token price at time of claim */
  tokenPrice: number
}

/**
 * Lending claimed reward with transaction details
 */
export type LendingClaimedReward = {
  /** Coin transaction result */
  coin: TransactionResult
  /** Pool identifier */
  identifier: Pool
}

/**
 * Transaction information for lending operations
 */
export type Transaction = {
  /** Transaction type */
  type: string
  /** Transaction status */
  status: string
  /** Changes in coin balances */
  coinChanges: {
    /** Coin symbol */
    symbol: string
    /** Amount changed */
    amount: string
  }[]
  /** Transaction timestamp */
  timestamp: string
  /** Transaction digest */
  digest: string
}

/**
 * Comprehensive pool information for lending operations
 */
export type Pool = {
  /** Maximum borrow capacity */
  borrowCapCeiling: string
  /** Coin type for this pool */
  coinType: string
  /** Sui coin type */
  suiCoinType: string
  /** Current borrow index */
  currentBorrowIndex: string
  /** Current borrow rate */
  currentBorrowRate: string
  /** Current supply index */
  currentSupplyIndex: string
  /** Current supply rate */
  currentSupplyRate: string
  /** Pool identifier */
  id: number
  /** Whether this is an isolated pool */
  isIsolated: boolean
  /** Last update timestamp */
  lastUpdateTimestamp: string
  /** Loan-to-value ratio */
  ltv: string
  /** Oracle identifier */
  oracleId: number
  /** Maximum supply capacity */
  supplyCapCeiling: string
  /** Treasury balance */
  treasuryBalance: string
  /** Treasury factor */
  treasuryFactor: string
  /** Total supply amount */
  totalSupplyAmount: string
  /** Minimum transaction amount */
  minimumAmount: string
  /** Remaining supply capacity */
  leftSupply: string
  /** Valid borrow amount */
  validBorrowAmount: string
  /** Currently borrowed amount */
  borrowedAmount: string
  /** Remaining borrow capacity */
  leftBorrowAmount: string
  /** Available borrow amount */
  availableBorrow: string
  /** Oracle price information */
  oracle: {
    /** Price decimal places */
    decimal: number
    /** Oracle value */
    value: string
    /** Current price */
    price: string
    /** Oracle identifier */
    oracleId: number
    /** Whether oracle is valid */
    valid: boolean
  }
  /** Total supply */
  totalSupply: string
  /** Total borrow */
  totalBorrow: string
  /** Borrow rate calculation factors */
  borrowRateFactors: {
    fields: {
      /** Base interest rate */
      baseRate: string
      /** Rate multiplier */
      multiplier: string
      /** Jump rate multiplier */
      jumpRateMultiplier: string
      /** Optimal utilization rate */
      optimalUtilization: string
      /** Reserve factor */
      reserveFactor: string
    }
  }
  /** Liquidation parameters */
  liquidationFactor: {
    /** Liquidation bonus */
    bonus: string
    /** Liquidation ratio */
    ratio: string
    /** Liquidation threshold */
    threshold: string
  }
  /** Supply incentive APY information */
  supplyIncentiveApyInfo: {
    /** Vault APR */
    vaultApr: string
    /** Boosted APR */
    boostedApr: string
    /** Reward coin types */
    rewardCoin: string[]
    /** Total APY */
    apy: string
    /** Volo APY */
    voloApy: string
    /** Staking yield APY */
    stakingYieldApy: string
    /** Treasury APY */
    treasuryApy: string
  }
  /** Borrow incentive APY information */
  borrowIncentiveApyInfo: {
    /** Vault APR */
    vaultApr: string
    /** Boosted APR */
    boostedApr: string
    /** Reward coin types */
    rewardCoin: string[]
    /** Total APY */
    apy: string
    /** Volo APY */
    voloApy: string
    /** Staking yield APY */
    stakingYieldApy: string
    /** Treasury APY */
    treasuryApy: string
  }
  /** Token information */
  token: {
    /** Coin type */
    coinType: string
    /** Token decimals */
    decimals: number
    /** Token logo URI */
    logoURI: string
    /** Token symbol */
    symbol: string
  }
  /** Contract addresses */
  contract: {
    /** Reserve ID */
    reserveId: string
    /** Pool address */
    pool: string
    /** Optional reward fund ID */
    rewardFundId?: string
  }
}

/**
 * Asset identifier - can be string, Pool object, or number
 */
export type AssetIdentifier = string | Pool | number

/**
 * Flash loan asset configuration
 */
export type FloashloanAsset = {
  /** Maximum flash loan amount */
  max: string
  /** Minimum flash loan amount */
  min: string
  /** Asset identifier */
  assetId: number
  /** Pool identifier */
  poolId: string
  /** Supplier fee percentage */
  supplierFee: number
  /** Flash loan fee percentage */
  flashloanFee: number
  /** Coin type */
  coinType: string
}

/**
 * Pool statistics and metrics
 */
export type PoolStats = {
  /** Total value locked */
  tvl: number
  /** Total borrow in USD */
  totalBorrowUsd: number
  /** Average utilization rate */
  averageUtilization: number
  /** Maximum APY */
  maxApy: number
  /** Number of users */
  userAmount: number
  /** Number of active users */
  interactionUserAmount: number
  /** Borrow fee percentage */
  borrowFee: number
  /** Borrow fee collection address */
  borrowFeeAddress: string
}

/**
 * Oracle price feed configuration
 */
export type OraclePriceFeed = {
  /** Oracle identifier */
  oracleId: number
  /** Feed identifier */
  feedId: string
  /** Asset identifier */
  assetId: number
  /** Pyth price feed ID */
  pythPriceFeedId: string
  /** Pyth price info object */
  pythPriceInfoObject: string
  /** Coin type */
  coinType: string
  /** Price decimal places */
  priceDecimal: number
  /** Supra pair identifier */
  supraPairId: number
}

/**
 * Lending protocol configuration
 */
export type LendingConfig = {
  /** Main package address */
  package: string
  /** Storage contract address */
  storage: string
  /** Incentive V2 contract address */
  incentiveV2: string
  /** Incentive V3 contract address */
  incentiveV3: string
  /** Price oracle contract address */
  priceOracle: string
  /** UI getter contract address */
  uiGetter: string
  /** Reserve parent ID */
  reserveParentId: string
  /** Flash loan configuration address */
  flashloanConfig: string
  /** Flash loan supported assets address */
  flashloanSupportedAssets: string
  /** Oracle configuration */
  oracle: {
    /** Package ID */
    packageId: string
    /** Price oracle contract address */
    priceOracle: string
    /** Oracle admin capability ID */
    oracleAdminCap: string
    /** Oracle configuration object */
    oracleConfig: string
    /** Pyth state ID */
    pythStateId: string
    /** Wormhole state ID */
    wormholeStateId: string
    /** Supra oracle holder address */
    supraOracleHolder: string
    /** Sender address for oracle updates */
    sender: string
    /** Gas object ID for oracle updates */
    gasObject: string
    /** Price feeds */
    feeds: OraclePriceFeed[]
  }
}

/**
 * Fee detail information for lending operations
 */
export type FeeDetail = {
  /** Coin identifier */
  coinId: string
  /** Coin symbol */
  coinSymbol: string
  /** Coin type */
  coinType: string
  /** Fee object identifier */
  feeObjectId: string
  /** Current fee amount */
  currentAmount: number
  /** Current price */
  price: number
  /** Current value in USD */
  currentValue: number
}

/**
 * Union type for coin objects in transactions
 *
 * This type represents various ways to reference coins in transaction building,
 * including transaction results, gas coins, input references, and direct strings.
 */
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
