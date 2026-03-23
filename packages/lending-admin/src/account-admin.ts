import { Transaction } from '@mysten/sui/transactions'
import { getAdminConfig, DEFAULT_CACHE_TIME } from './config'
import type { CoinObject, AssetIdentifier, ResolveConfigOptions, TransactionResult } from './types'
import { parseTxValue } from './utils'

function resolvePoolRef(pool: AssetIdentifier) {
  if (typeof pool === 'string') {
    return pool
  }
  return pool.pool
}

function resolveAssetId(pool: AssetIdentifier, maybeAssetId?: number) {
  if (typeof maybeAssetId === 'number') {
    return maybeAssetId
  }
  if (typeof pool === 'object') {
    return pool.id
  }
  throw new Error('assetId is required when pool is provided as object id')
}

function resolveStorage(options: ResolveConfigOptions, fallbackStorage: string) {
  return options.storage || fallbackStorage
}

function resolveIncentiveV3(options: ResolveConfigOptions, fallbackIncentiveV3: string) {
  return options.incentiveV3 || fallbackIncentiveV3
}

export async function depositOnBehalfOfUserPTB(
  tx: Transaction,
  input: {
    coinType: string
    depositCoin: CoinObject
    amount: number | bigint | TransactionResult
    pool: AssetIdentifier
    user: string
    assetId?: number
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_deposit_on_behalf_of_user`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object('0x06'),
      tx.object(resolveStorage(options, config.storage)),
      tx.object(resolvePoolRef(input.pool)),
      tx.pure.u8(resolveAssetId(input.pool, input.assetId)),
      parseTxValue(input.depositCoin, tx.object),
      parseTxValue(input.amount, tx.pure.u64),
      tx.pure.address(input.user),
      tx.object(config.incentiveV2),
      tx.object(resolveIncentiveV3(options, config.incentiveV3))
    ]
  })
  return tx
}

export async function repayOnBehalfOfUserPTB(
  tx: Transaction,
  input: {
    coinType: string
    repayCoin: CoinObject
    amount: number | bigint | TransactionResult
    pool: AssetIdentifier
    user: string
    assetId?: number
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_repay_on_behalf_of_user`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(resolveStorage(options, config.storage)),
      tx.object(resolvePoolRef(input.pool)),
      tx.pure.u8(resolveAssetId(input.pool, input.assetId)),
      parseTxValue(input.repayCoin, tx.object),
      parseTxValue(input.amount, tx.pure.u64),
      tx.pure.address(input.user),
      tx.object(config.incentiveV2),
      tx.object(resolveIncentiveV3(options, config.incentiveV3))
    ]
  })
  return tx
}

export async function withdrawOnBehalfOfUserPTB(
  tx: Transaction,
  input: {
    coinType: string
    amount: number | bigint | TransactionResult
    pool: AssetIdentifier
    user: string
    assetId?: number
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_withdraw_on_behalf_of_user_v2`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(resolveStorage(options, config.storage)),
      tx.object(resolvePoolRef(input.pool)),
      tx.pure.u8(resolveAssetId(input.pool, input.assetId)),
      parseTxValue(input.amount, tx.pure.u64),
      tx.pure.address(input.user),
      tx.object(config.incentiveV2),
      tx.object(resolveIncentiveV3(options, config.incentiveV3)),
      tx.object('0x05')
    ]
  })
  return tx
}

export async function borrowOnBehalfOfUserPTB(
  tx: Transaction,
  input: {
    coinType: string
    amount: number | bigint | TransactionResult
    pool: AssetIdentifier
    user: string
    assetId?: number
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_borrow_on_behalf_of_user_v2`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(resolveStorage(options, config.storage)),
      tx.object(resolvePoolRef(input.pool)),
      tx.pure.u8(resolveAssetId(input.pool, input.assetId)),
      parseTxValue(input.amount, tx.pure.u64),
      tx.pure.address(input.user),
      tx.object(config.incentiveV2),
      tx.object(resolveIncentiveV3(options, config.incentiveV3)),
      tx.object('0x05')
    ]
  })
  return tx
}

export async function depositWithAccountCapPTB(
  tx: Transaction,
  input: {
    coinType: string
    depositCoin: CoinObject
    pool: AssetIdentifier
    accountCap: string | TransactionResult
    assetId?: number
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::incentive_v3::deposit_with_account_cap`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object('0x06'),
      tx.object(resolveStorage(options, config.storage)),
      tx.object(resolvePoolRef(input.pool)),
      tx.pure.u8(resolveAssetId(input.pool, input.assetId)),
      parseTxValue(input.depositCoin, tx.object),
      tx.object(config.incentiveV2),
      tx.object(resolveIncentiveV3(options, config.incentiveV3)),
      parseTxValue(input.accountCap, tx.object)
    ]
  })
  return tx
}
