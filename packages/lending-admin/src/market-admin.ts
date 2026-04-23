import { lendingTarget, resolveAdminPTBContext, resolveObjectArgument } from './ptb'
import type { AdminPTBOptions, PTBObjectArgument } from './ptb'

type MarketObjects = {
  storage?: PTBObjectArgument
  incentive?: PTBObjectArgument
}

export async function createNewMarketPTB(
  options?: AdminPTBOptions & { storage?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_new_market'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function initFieldsBatchPTB(options?: AdminPTBOptions & MarketObjects) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'init_fields_batch'),
    arguments: [
      tx.object(config.lending.ownerCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage),
      resolveObjectArgument(tx, options?.incentive ?? config.lending.incentiveV3)
    ]
  })

  return tx
}

export async function initForMainMarketPTB(
  options?: AdminPTBOptions & { storage?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'init_for_main_market'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function initBorrowWeightForMainMarketPTB(
  options?: AdminPTBOptions & { storage?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'init_borrow_weight_for_main_market'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function setBorrowWeightBpsRawPTB(
  options: AdminPTBOptions &
    MarketObjects & {
      assetId: number
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_borrow_weight'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.u8(options.assetId),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setBorrowWeightBpsPTB = setBorrowWeightBpsRawPTB

export async function removeBorrowWeightPTB(
  options: AdminPTBOptions &
    MarketObjects & {
      assetId: number
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'remove_borrow_weight'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.u8(options.assetId)
    ]
  })

  return tx
}
