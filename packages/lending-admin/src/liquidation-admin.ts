import { lendingTarget, resolveAdminPTBContext, resolveObjectArgument } from './ptb'
import type { AdminPTBOptions, PTBObjectArgument } from './ptb'

type LiquidationStorageOption = {
  storage?: PTBObjectArgument
}

export async function setDesignatedLiquidatorPTB(
  options: AdminPTBOptions &
    LiquidationStorageOption & {
      liquidator: string
      user: string
      isDesignated: boolean
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_designated_liquidators'),
    arguments: [
      tx.object(config.lending.ownerCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.address(options.liquidator),
      tx.pure.address(options.user),
      tx.pure.bool(options.isDesignated)
    ]
  })

  return tx
}

export async function setProtectedLiquidationUserPTB(
  options: AdminPTBOptions &
    LiquidationStorageOption & {
      user: string
      isProtected: boolean
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_protected_liquidation_users'),
    arguments: [
      tx.object(config.lending.ownerCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.address(options.user),
      tx.pure.bool(options.isProtected)
    ]
  })

  return tx
}
