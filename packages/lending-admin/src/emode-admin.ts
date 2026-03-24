import { encodeRayRate } from './precision'
import { lendingTarget, resolveAdminPTBContext, resolveObjectArgument } from './ptb'
import type { RayRateInput } from './types'
import type { AdminPTBOptions, PTBObjectArgument } from './ptb'

type EmodeAssetRawConfig = {
  assetId: number
  isCollateral: boolean
  isDebt: boolean
  ltv: string
  lt: string
  liquidationBonus: string
}

type EmodeAssetConfig = {
  assetId: number
  isCollateral: boolean
  isDebt: boolean
  ltv: RayRateInput
  lt: RayRateInput
  liquidationBonus: RayRateInput
}

type EmodeSetterRawOptions = AdminPTBOptions & {
  emodeId: string
  assetId: number
  value: string
  storage?: PTBObjectArgument
}

type EmodeSetterOptions = AdminPTBOptions & {
  emodeId: string
  assetId: number
  value: RayRateInput
  storage?: PTBObjectArgument
}

function buildCreateEmodeAssetRaw(
  tx: Awaited<ReturnType<typeof resolveAdminPTBContext>>['tx'],
  config: Awaited<ReturnType<typeof resolveAdminPTBContext>>['config'],
  asset: EmodeAssetRawConfig
) {
  const [emodeAsset] = tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_emode_asset'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.pure.u8(asset.assetId),
      tx.pure.bool(asset.isCollateral),
      tx.pure.bool(asset.isDebt),
      tx.pure.u256(asset.ltv),
      tx.pure.u256(asset.lt),
      tx.pure.u256(asset.liquidationBonus)
    ]
  })

  return emodeAsset
}

function encodeEmodeAsset(asset: EmodeAssetConfig): EmodeAssetRawConfig {
  return {
    assetId: asset.assetId,
    isCollateral: asset.isCollateral,
    isDebt: asset.isDebt,
    ltv: encodeRayRate(asset.ltv, { bounded: true, fieldName: 'emode.ltv' }),
    lt: encodeRayRate(asset.lt, { bounded: true, fieldName: 'emode.lt' }),
    liquidationBonus: encodeRayRate(asset.liquidationBonus, {
      bounded: true,
      fieldName: 'emode.liquidationBonus'
    })
  }
}

function makeEmodeSetter(functionName: string) {
  return async (options: EmodeSetterOptions) => {
    return makeEmodeSetterRaw(functionName)({
      ...options,
      value: encodeRayRate(options.value, {
        bounded: true,
        fieldName: functionName
      })
    })
  }
}

function makeEmodeSetterRaw(functionName: string) {
  return async (options: EmodeSetterRawOptions) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: lendingTarget(config, 'manage', functionName),
      arguments: [
        tx.object(config.lending.storageAdminCap),
        resolveObjectArgument(tx, options.storage ?? config.lending.storage),
        tx.pure.u64(options.emodeId),
        tx.pure.u8(options.assetId),
        tx.pure.u256(options.value)
      ]
    })

    return tx
  }
}

export async function initEmodeForMainMarketPTB(
  options?: AdminPTBOptions & { storage?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'init_emode_for_main_market'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function createEmodeAssetRawPTB(options: AdminPTBOptions & EmodeAssetRawConfig) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const emodeAsset = buildCreateEmodeAssetRaw(tx, config, options)

  return { tx, emodeAsset }
}

export async function createEmodeAssetPTB(options: AdminPTBOptions & EmodeAssetConfig) {
  return createEmodeAssetRawPTB({
    ...options,
    ...encodeEmodeAsset(options)
  })
}

export async function createEmodePairRawPTB(
  options: AdminPTBOptions & {
    storage?: PTBObjectArgument
    assetA: EmodeAssetRawConfig
    assetB: EmodeAssetRawConfig
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const assetA = buildCreateEmodeAssetRaw(tx, config, options.assetA)
  const assetB = buildCreateEmodeAssetRaw(tx, config, options.assetB)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_emode_pair'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      assetA,
      assetB
    ]
  })

  return tx
}

export async function createEmodePairPTB(
  options: AdminPTBOptions & {
    storage?: PTBObjectArgument
    assetA: EmodeAssetConfig
    assetB: EmodeAssetConfig
  }
) {
  return createEmodePairRawPTB({
    ...options,
    assetA: encodeEmodeAsset(options.assetA),
    assetB: encodeEmodeAsset(options.assetB)
  })
}

export async function setEmodeConfigActivePTB(
  options: AdminPTBOptions & {
    emodeId: string
    isActive: boolean
    storage?: PTBObjectArgument
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_emode_config_active'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.u64(options.emodeId),
      tx.pure.bool(options.isActive)
    ]
  })

  return tx
}

export const setEmodeAssetLtPTB = makeEmodeSetter('set_emode_asset_lt')
export const setEmodeAssetLtRawPTB = makeEmodeSetterRaw('set_emode_asset_lt')
export const setEmodeAssetLtvPTB = makeEmodeSetter('set_emode_asset_ltv')
export const setEmodeAssetLtvRawPTB = makeEmodeSetterRaw('set_emode_asset_ltv')
export const setEmodeAssetLiquidationBonusPTB = makeEmodeSetter('set_emode_asset_liquidation_bonus')
export const setEmodeAssetLiquidationBonusRawPTB = makeEmodeSetterRaw(
  'set_emode_asset_liquidation_bonus'
)
