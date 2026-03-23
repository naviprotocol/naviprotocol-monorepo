import { Transaction } from '@mysten/sui/transactions'
import type { ResolveConfigOptions, TransactionResult } from './types'
import { getAdminConfig, DEFAULT_CACHE_TIME } from './config'

/**
 * Mints and transfers borrow fee cap to recipient.
 */
export async function mintBorrowFeeCapPTB(
  tx: Transaction,
  recipient: string,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::manage::mint_borrow_fee_cap`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.pure.address(recipient)
    ]
  })
}

/**
 * Sets global borrow fee rate with borrow fee cap.
 * Rate should be decimal form, e.g. 0.005 means 0.5%.
 */
export async function setBorrowFeeRatePTB(
  tx: Transaction,
  rate: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const borrowFeeCap = options?.borrowFeeCap || config.borrowFeeCap
  if (!borrowFeeCap) {
    throw new Error('borrowFeeCap is required in admin config')
  }
  if (rate < 0) {
    throw new Error('rate must be non-negative')
  }

  return tx.moveCall({
    target: `${config.package}::manage::set_borrow_fee_rate`,
    arguments: [
      tx.object(borrowFeeCap),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.pure.u64(Math.round(rate * 10000))
    ]
  })
}

/**
 * Sets asset-level borrow fee rate with borrow fee cap.
 */
export async function setAssetBorrowFeeRatePTB(
  tx: Transaction,
  assetId: number,
  rate: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const borrowFeeCap = options?.borrowFeeCap || config.borrowFeeCap
  if (!borrowFeeCap) {
    throw new Error('borrowFeeCap is required in admin config')
  }
  if (rate < 0) {
    throw new Error('rate must be non-negative')
  }

  return tx.moveCall({
    target: `${config.package}::manage::set_asset_borrow_fee_rate`,
    arguments: [
      tx.object(borrowFeeCap),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.pure.u8(assetId),
      tx.pure.u64(Math.round(rate * 10000))
    ]
  })
}

/**
 * Sets user-level borrow fee rate with borrow fee cap.
 */
export async function setUserBorrowFeeRatePTB(
  tx: Transaction,
  user: string,
  assetId: number,
  rate: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const borrowFeeCap = options?.borrowFeeCap || config.borrowFeeCap
  if (!borrowFeeCap) {
    throw new Error('borrowFeeCap is required in admin config')
  }
  if (rate < 0) {
    throw new Error('rate must be non-negative')
  }

  return tx.moveCall({
    target: `${config.package}::manage::set_user_borrow_fee_rate`,
    arguments: [
      tx.object(borrowFeeCap),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.pure.address(user),
      tx.pure.u8(assetId),
      tx.pure.u64(Math.round(rate * 10000))
    ]
  })
}

/**
 * Removes asset-level borrow fee rate override.
 */
export async function removeAssetBorrowFeeRatePTB(
  tx: Transaction,
  assetId: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const borrowFeeCap = options?.borrowFeeCap || config.borrowFeeCap
  if (!borrowFeeCap) {
    throw new Error('borrowFeeCap is required in admin config')
  }

  return tx.moveCall({
    target: `${config.package}::manage::remove_incentive_v3_asset_borrow_fee_rate`,
    arguments: [
      tx.object(borrowFeeCap),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.pure.u8(assetId)
    ]
  })
}

/**
 * Removes user-level borrow fee rate override.
 */
export async function removeUserBorrowFeeRatePTB(
  tx: Transaction,
  user: string,
  assetId: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const borrowFeeCap = options?.borrowFeeCap || config.borrowFeeCap
  if (!borrowFeeCap) {
    throw new Error('borrowFeeCap is required in admin config')
  }

  return tx.moveCall({
    target: `${config.package}::manage::remove_incentive_v3_user_borrow_fee_rate`,
    arguments: [
      tx.object(borrowFeeCap),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.pure.address(user),
      tx.pure.u8(assetId)
    ]
  })
}

/**
 * Sets designated liquidator relation between liquidator and user.
 */
export async function setDesignatedLiquidatorsPTB(
  tx: Transaction,
  liquidator: string,
  user: string,
  isDesignated: boolean,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::manage::set_designated_liquidators`,
    arguments: [
      tx.object(options?.storageOwnerCap || config.storageOwnerCap),
      tx.object(options?.storage || config.storage),
      tx.pure.address(liquidator),
      tx.pure.address(user),
      tx.pure.bool(isDesignated)
    ]
  })
}

/**
 * Sets whether a user is protected from liquidation.
 */
export async function setProtectedLiquidationUsersPTB(
  tx: Transaction,
  user: string,
  isProtected: boolean,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::manage::set_protected_liquidation_users`,
    arguments: [
      tx.object(options?.storageOwnerCap || config.storageOwnerCap),
      tx.object(options?.storage || config.storage),
      tx.pure.address(user),
      tx.pure.bool(isProtected)
    ]
  })
}

/**
 * Sets lending storage pause state.
 */
export async function setPausePTB(
  tx: Transaction,
  val: boolean,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::storage::set_pause`,
    arguments: [
      tx.object(options?.storageOwnerCap || config.storageOwnerCap),
      tx.object(options?.storage || config.storage),
      tx.pure.bool(val)
    ]
  })
}

/**
 * Sets oracle pause state.
 */
export async function setOraclePausePTB(
  tx: Transaction,
  val: boolean,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.oracle.packageId}::oracle_manage::set_pause`,
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.bool(val)
    ]
  })
}

/**
 * Manually updates reward state for a specific asset.
 */
export async function manualUpdateRewardStateByAssetPTB(
  tx: Transaction,
  coinType: string,
  timediff: number,
  user: string,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::incentive_v3::manual_update_reward_state_by_asset`,
    typeArguments: [coinType],
    arguments: [
      tx.object(options?.storageAdminCap || config.storageAdminCap),
      tx.pure.u64(timediff),
      tx.object(options?.incentiveV3 || config.incentiveV3),
      tx.object(options?.storage || config.storage),
      tx.pure.address(user)
    ]
  })
}

/**
 * Manually updates lending state for all assets.
 */
export async function manualUpdateStateOfAllPTB(
  tx: Transaction,
  timediff: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::logic::manual_update_state_of_all`,
    arguments: [tx.object(options?.storage || config.storage), tx.pure.u64(timediff)]
  })
}

/**
 * Manually updates lending state for one asset.
 */
export async function manualUpdateStatePTB(
  tx: Transaction,
  timediff: number,
  assetId: number,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  return tx.moveCall({
    target: `${config.package}::logic::manual_update_state`,
    arguments: [
      tx.object(options?.storage || config.storage),
      tx.pure.u8(assetId),
      tx.pure.u64(timediff)
    ]
  })
}
