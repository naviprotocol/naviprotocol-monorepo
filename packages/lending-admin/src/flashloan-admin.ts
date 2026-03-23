import { Transaction } from '@mysten/sui/transactions'
import { DEFAULT_CACHE_TIME, getAdminConfig } from './config'
import type { BigintLike, ResolveConfigOptions } from './types'

/**
 * Creates flash loan config under the specified storage.
 */
export async function createFlashLoanConfigPTB(
  tx: Transaction,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  tx.moveCall({
    target: `${config.package}::manage::create_flash_loan_config_with_storage`,
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(options.storage || config.storage)
    ]
  })
  return tx
}

/**
 * Creates one flash loan asset config entry.
 */
export async function createFlashLoanAssetPTB(
  tx: Transaction,
  input: {
    coinType: string
    pool: string
    assetId: number
    rateToSupplier: BigintLike
    rateToTreasury: BigintLike
    maximum: BigintLike
    minimum: BigintLike
  },
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const flashloanConfig = options.flashloanConfig || config.flashloanConfig
  if (!flashloanConfig) {
    throw new Error('flashloanConfig is required in admin config')
  }
  tx.moveCall({
    target: `${config.package}::manage::create_flash_loan_asset`,
    typeArguments: [input.coinType],
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(flashloanConfig),
      tx.object(options.storage || config.storage),
      tx.object(input.pool),
      tx.pure.u8(input.assetId),
      tx.pure.u64(input.rateToSupplier),
      tx.pure.u64(input.rateToTreasury),
      tx.pure.u64(input.maximum),
      tx.pure.u64(input.minimum)
    ]
  })
  return tx
}
