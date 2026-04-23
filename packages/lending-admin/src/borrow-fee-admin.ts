import { lendingTarget, resolveAdminPTBContext, resolveObjectArgument } from './ptb'
import type { AdminPTBOptions, PTBObjectArgument } from './ptb'

type BorrowFeeObjects = {
  borrowFeeCap: PTBObjectArgument
  incentive?: PTBObjectArgument
}

export async function mintBorrowFeeCapPTB(
  options: AdminPTBOptions & {
    recipient: string
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'mint_borrow_fee_cap'),
    arguments: [tx.object(config.lending.storageAdminCap), tx.pure.address(options.recipient)]
  })

  return tx
}

export async function setBorrowFeeRateBpsRawPTB(
  options: AdminPTBOptions &
    BorrowFeeObjects & {
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_borrow_fee_rate'),
    arguments: [
      resolveObjectArgument(tx, options.borrowFeeCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setBorrowFeeRateBpsPTB = setBorrowFeeRateBpsRawPTB

export async function setAssetBorrowFeeRateBpsRawPTB(
  options: AdminPTBOptions &
    BorrowFeeObjects & {
      assetId: number
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_asset_borrow_fee_rate'),
    arguments: [
      resolveObjectArgument(tx, options.borrowFeeCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u8(options.assetId),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setAssetBorrowFeeRateBpsPTB = setAssetBorrowFeeRateBpsRawPTB

export async function setUserBorrowFeeRateBpsRawPTB(
  options: AdminPTBOptions &
    BorrowFeeObjects & {
      user: string
      assetId: number
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_user_borrow_fee_rate'),
    arguments: [
      resolveObjectArgument(tx, options.borrowFeeCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.address(options.user),
      tx.pure.u8(options.assetId),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setUserBorrowFeeRateBpsPTB = setUserBorrowFeeRateBpsRawPTB

export async function removeAssetBorrowFeeRatePTB(
  options: AdminPTBOptions &
    BorrowFeeObjects & {
      assetId: number
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'remove_incentive_v3_asset_borrow_fee_rate'),
    arguments: [
      resolveObjectArgument(tx, options.borrowFeeCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u8(options.assetId)
    ]
  })

  return tx
}

export async function removeUserBorrowFeeRatePTB(
  options: AdminPTBOptions &
    BorrowFeeObjects & {
      user: string
      assetId: number
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'remove_incentive_v3_user_borrow_fee_rate'),
    arguments: [
      resolveObjectArgument(tx, options.borrowFeeCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.address(options.user),
      tx.pure.u8(options.assetId)
    ]
  })

  return tx
}
