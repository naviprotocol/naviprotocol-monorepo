import { Transaction } from '@mysten/sui/transactions'
import type { BigintLike, EModeAssetInput, ResolveConfigOptions, TransactionResult } from './types'
import { DEFAULT_CACHE_TIME, getAdminConfig } from './config'
import { parseTxValue } from './utils'

/**
 * Creates a transient EMode asset object for later pairing in the same transaction.
 */
export async function createEModeAssetPTB(
  tx: Transaction,
  input: EModeAssetInput,
  options: ResolveConfigOptions = {}
): Promise<TransactionResult> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const [emodeAsset] = tx.moveCall({
    target: `${config.package}::manage::create_emode_asset`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.pure.u8(input.assetId),
      tx.pure.bool(input.isCollateral),
      tx.pure.bool(input.isDebt),
      tx.pure.u256(input.ltv),
      tx.pure.u256(input.lt),
      tx.pure.u256(input.liquidationBonus)
    ]
  })
  return emodeAsset as TransactionResult
}

/**
 * Creates an EMode pair from two temporary emode assets.
 */
export async function createEModePairPTB(
  tx: Transaction,
  assetA: string | TransactionResult,
  assetB: string | TransactionResult,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::create_emode_pair`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage),
      parseTxValue(assetA, tx.object),
      parseTxValue(assetB, tx.object)
    ]
  })
  return tx
}

/**
 * Convenience helper: creates two emode assets and pairs them.
 */
export async function createEModePTB(
  tx: Transaction,
  input: {
    assetA: EModeAssetInput
    assetB: EModeAssetInput
  },
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const emodeAssetA = await createEModeAssetPTB(tx, input.assetA, options)
  const emodeAssetB = await createEModeAssetPTB(tx, input.assetB, options)
  return createEModePairPTB(tx, emodeAssetA, emodeAssetB, options)
}

/**
 * Sets whether an emode config is active.
 */
export async function setEModeConfigActivePTB(
  tx: Transaction,
  emodeId: BigintLike,
  isActive: boolean,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::set_emode_config_active`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage),
      tx.pure.u64(emodeId),
      tx.pure.bool(isActive)
    ]
  })
  return tx
}

/**
 * Sets EMode asset LT.
 */
export async function setEModeAssetLtPTB(
  tx: Transaction,
  emodeId: BigintLike,
  assetId: number,
  lt: BigintLike,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::set_emode_asset_lt`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage),
      tx.pure.u64(emodeId),
      tx.pure.u8(assetId),
      tx.pure.u256(lt)
    ]
  })
  return tx
}

/**
 * Sets EMode asset LTV.
 */
export async function setEModeAssetLtvPTB(
  tx: Transaction,
  emodeId: BigintLike,
  assetId: number,
  ltv: BigintLike,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::set_emode_asset_ltv`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage),
      tx.pure.u64(emodeId),
      tx.pure.u8(assetId),
      tx.pure.u256(ltv)
    ]
  })
  return tx
}

/**
 * Sets EMode asset liquidation bonus.
 */
export async function setEModeAssetLiquidationBonusPTB(
  tx: Transaction,
  emodeId: BigintLike,
  assetId: number,
  liquidationBonus: BigintLike,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::set_emode_asset_liquidation_bonus`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage),
      tx.pure.u64(emodeId),
      tx.pure.u8(assetId),
      tx.pure.u256(liquidationBonus)
    ]
  })
  return tx
}
