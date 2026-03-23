import type { ResolveConfigOptions } from './types'
import { DEFAULT_CACHE_TIME, getAdminConfig } from './config'
import { parseTxValue } from './utils'
import { Transaction } from '@mysten/sui/transactions'

/**
 * Creates a new market in storage.
 */
export async function createNewMarketPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::create_new_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })

  return tx
}

/**
 * Initializes dynamic fields required by market in batch.
 */
export async function initFieldsBatchPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::init_fields_batch`,
    arguments: [
      tx.object(options.storageOwnerCap || config.storageOwnerCap),
      tx.object(options.storage || config.storage),
      tx.object(options.incentiveV3 || config.incentiveV3)
    ]
  })

  return tx
}

/**
 * Migrates incentive v2, storage and flash loan config to the latest version.
 */
export async function versionMigratePTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v2::version_migrate`,
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(config.incentiveV2)
    ]
  })

  tx.moveCall({
    target: `${config.package}::storage::version_migrate`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })

  if (config.flashloanConfig) {
    tx.moveCall({
      target: `${config.package}::flash_loan::version_migrate`,
      arguments: [
        tx.object(options.storageAdminCap || config.storageAdminCap),
        tx.object(options.flashloanConfig || config.flashloanConfig)
      ]
    })
  }

  return tx
}

/**
 * Migrates incentive v3 object to latest version.
 */
export async function versionMigrateV3PTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::incentive_v3_version_migrate`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.incentiveV3 || config.incentiveV3)
    ]
  })

  return tx
}

/**
 * Initializes incentive v3 main market data.
 */
export async function initIncentiveMainMarketPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v3::init_for_main_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.incentiveV3 || config.incentiveV3)
    ]
  })

  return tx
}

/**
 * Initializes storage emode data for main market.
 */
export async function initStorageMainMarketEmodePTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::storage::init_emode_for_main_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })

  return tx
}

/**
 * Initializes storage main market defaults.
 */
export async function initStorageMainMarketPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::storage::init_for_main_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })

  return tx
}

/**
 * Initializes borrow weight for main market.
 */
export async function initBorrowWeightMainMarketPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::storage::init_borrow_weight_for_main_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })

  return tx
}

/**
 * Initializes flashloan config for main market.
 */
export async function initFlashloanMainMarketPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const flashloanConfig = options.flashloanConfig || config.flashloanConfig
  if (!flashloanConfig) {
    throw new Error('flashloanConfig is required for flashloan main market initialization')
  }

  tx.moveCall({
    target: `${config.package}::flash_loan::init_config_for_main_market`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(flashloanConfig)
    ]
  })

  return tx
}

/**
 * Initializes a pool in main market by pool object id.
 */
export async function initPoolMainMarketPTB(
  tx: Transaction,
  coinType: string,
  pool: string,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::pool::init_pool_for_main_market`,
    typeArguments: [coinType],
    arguments: [tx.object(options.poolAdminCap || config.poolAdminCap), tx.object(pool)]
  })

  return tx
}

/**
 * Initializes reward fund in main market by reward fund object id.
 */
export async function initFundMainMarketPTB(
  tx: Transaction,
  rewardCoinType: string,
  rewardFund: string,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v3::init_fund_for_market`,
    typeArguments: [rewardCoinType],
    arguments: [tx.object(options.storageAdminCap || config.storageAdminCap), tx.object(rewardFund)]
  })

  return tx
}

/**
 * Sets update interval for oracle price update jobs.
 */
export async function setOracleUpdateIntervalPTB(
  tx: Transaction,
  interval: number,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.oracle.packageId}::oracle::set_update_interval`,
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.priceOracle),
      parseTxValue(interval, tx.pure.u64)
    ]
  })

  return tx
}

/**
 * Runs oracle version migration.
 */
export async function versionMigrateOraclePTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.oracle.packageId}::oracle_manage::version_migrate`,
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.object(config.oracle.priceOracle)
    ]
  })

  return tx
}

/**
 * Creates oracle config object.
 */
export async function createOracleConfigPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.oracle.packageId}::oracle_manage::create_config`,
    arguments: [tx.object(config.oracle.oracleAdminCap)]
  })

  return tx
}

/**
 * Updates one token price manually.
 */
export async function updateTokenPricePTB(
  tx: Transaction,
  input: {
    oracleId: number
    tokenPrice: number | bigint | string
  },
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.oracle.packageId}::oracle::update_token_price`,
    arguments: [
      tx.object(config.oracle.oracleFeederCap),
      tx.object('0x6'),
      tx.object(config.oracle.priceOracle),
      tx.pure.u8(input.oracleId),
      tx.pure.u256(input.tokenPrice)
    ]
  })

  return tx
}

/**
 * Registers one token price with oracle id and decimals.
 */
export async function registerTokenPricePTB(
  tx: Transaction,
  input: {
    oracleId: number
    initialPrice: number | bigint | string
    priceDecimal: number
  },
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.oracle.packageId}::oracle::register_token_price`,
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object('0x6'),
      tx.object(config.oracle.priceOracle),
      tx.pure.u8(input.oracleId),
      tx.pure.u256(input.initialPrice),
      tx.pure.u8(input.priceDecimal)
    ]
  })

  return tx
}
