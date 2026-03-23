import { Transaction } from '@mysten/sui/transactions'
import type { InitReserveParams, ResolveConfigOptions } from './types'
import { DEFAULT_CACHE_TIME, getAdminConfig } from './config'

/**
 * Initialize a reserve for a specific asset.
 */
export async function initReservePTB(
  tx: Transaction,
  params: InitReserveParams,
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const storage = options.storage || config.storage
  const storageAdminCap = options.storageAdminCap || config.storageAdminCap
  const poolAdminCap = options.poolAdminCap || config.poolAdminCap
  tx.moveCall({
    target: `${config.package}::storage::init_reserve`,
    arguments: [
      tx.object(storageAdminCap),
      tx.object(poolAdminCap),
      tx.object('0x6'),
      tx.object(storage),
      tx.pure.u8(params.oracleId),
      tx.pure.bool(params.isIsolated || false),
      tx.pure.u256(params.supplyCap.toString()),
      tx.pure.u256(params.borrowCap.toString()),
      tx.pure.u256(params.baseRate.toString()),
      tx.pure.u256(params.optimalUtilization.toString()),
      tx.pure.u256(params.multiplier.toString()),
      tx.pure.u256(params.jumpRate.toString()),
      tx.pure.u256(params.reserveFactor.toString()),
      tx.pure.u256(params.ltv.toString()),
      tx.pure.u256(params.treasuryFactor.toString()),
      tx.pure.u256(params.liquidationRatio.toString()),
      tx.pure.u256(params.liquidationBonus.toString()),
      tx.pure.u256(params.liquidationThreshold.toString()),
      tx.object(params.metadataObject)
    ],
    typeArguments: [params.coinType]
  })
  return tx
}

/**
 * Initialize SUI pool manager.
 */
export async function initSuiPoolManagerPTB(
  tx: Transaction,
  params: {
    stakePool: string
    metadata: string
    targetSuiAmount: string | number | bigint
    suiPoolId?: string
  },
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const poolAdminCap = options.poolAdminCap || config.poolAdminCap
  const suiPoolId = params.suiPoolId || options.suiPoolId || config.suiPoolId
  if (!suiPoolId) {
    throw new Error('suiPoolId is required')
  }
  tx.moveCall({
    target: `${config.package}::pool::init_sui_pool_manager`,
    arguments: [
      tx.object(poolAdminCap),
      tx.object(suiPoolId),
      tx.object(params.stakePool),
      tx.object(params.metadata),
      tx.pure.u64(params.targetSuiAmount.toString())
    ]
  })
  return tx
}

/**
 * Enable manage mode on SUI pool.
 */
export async function enableSuiPoolManagerPTB(tx: Transaction, options: ResolveConfigOptions = {}) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const poolAdminCap = options.poolAdminCap || config.poolAdminCap
  const suiPoolId = options.suiPoolId || config.suiPoolId
  if (!suiPoolId) {
    throw new Error('suiPoolId is required')
  }
  tx.moveCall({
    target: `${config.package}::pool::enable_manage`,
    arguments: [tx.object(poolAdminCap), tx.object(suiPoolId)]
  })
  return tx
}

/**
 * Refresh SUI pool stake state.
 */
export async function refreshStakePTB(tx: Transaction, options: ResolveConfigOptions = {}) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const suiPoolId = options.suiPoolId || config.suiPoolId
  if (!suiPoolId) {
    throw new Error('suiPoolId is required')
  }
  tx.moveCall({
    target: `${config.package}::pool::refresh_stake`,
    arguments: [tx.object(suiPoolId), tx.object('0x5')]
  })
  return tx
}

/**
 * Update target managed SUI amount.
 */
export async function setTargetSuiAmountPTB(
  tx: Transaction,
  amount: string | number | bigint,
  options: ResolveConfigOptions = {}
) {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const poolAdminCap = options.poolAdminCap || config.poolAdminCap
  const suiPoolId = options.suiPoolId || config.suiPoolId
  if (!suiPoolId) {
    throw new Error('suiPoolId is required')
  }
  tx.moveCall({
    target: `${config.package}::pool::set_target_sui_amount`,
    arguments: [
      tx.object(poolAdminCap),
      tx.object(suiPoolId),
      tx.pure.u64(amount.toString()),
      tx.object('0x5')
    ]
  })
  return tx
}
