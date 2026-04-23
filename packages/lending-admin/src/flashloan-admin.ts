import { encodeAmountInput } from './precision'
import {
  lendingTarget,
  resolveAdminConfig,
  resolveAdminPTBContext,
  resolveReserveSelection
} from './ptb'
import type { AmountInput } from './types'
import type { AdminPTBOptions, ReserveSelector } from './ptb'

type FlashLoanAssetRawOptions = AdminPTBOptions &
  ReserveSelector & {
    rateToSupplierBps: string
    rateToTreasuryBps: string
    maximum: string
    minimum: string
  }

type FlashLoanAssetOptions = AdminPTBOptions &
  ReserveSelector & {
    rateToSupplierBps: string
    rateToTreasuryBps: string
    maximum: AmountInput
    minimum: AmountInput
  }

type FlashLoanAmountRawOptions = AdminPTBOptions &
  ReserveSelector & {
    value: string
  }

type FlashLoanAmountOptions = AdminPTBOptions &
  ReserveSelector & {
    value: AmountInput
  }

function makeFlashLoanAmountSetter(functionName: string) {
  const setFlashLoanAmountRaw = makeFlashLoanAmountSetterRaw(functionName)

  return async (options: FlashLoanAmountOptions) => {
    const config = await resolveAdminConfig(options)
    const reserve = resolveReserveSelection(config, options)

    return setFlashLoanAmountRaw({
      ...options,
      config,
      value: encodeAmountInput(options.value, reserve.decimals)
    })
  }
}

function makeFlashLoanAmountSetterRaw(functionName: string) {
  return async (options: FlashLoanAmountRawOptions) => {
    const { tx, config } = await resolveAdminPTBContext(options)
    const reserve = resolveReserveSelection(config, options)

    tx.moveCall({
      target: lendingTarget(config, 'manage', functionName),
      typeArguments: [reserve.coinType],
      arguments: [
        tx.object(config.lending.storageAdminCap),
        tx.object(config.lending.flashloanConfig),
        tx.pure.u64(options.value)
      ]
    })

    return tx
  }
}

export async function createFlashLoanConfigPTB(options?: AdminPTBOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_flash_loan_config_with_storage'),
    arguments: [tx.object(config.lending.storageAdminCap), tx.object(config.lending.storage)]
  })

  return tx
}

export async function createFlashLoanAssetRawPTB(options: FlashLoanAssetRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_flash_loan_asset'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.object(config.lending.flashloanConfig),
      tx.object(config.lending.storage),
      tx.object(reserve.pool),
      tx.pure.u8(reserve.assetId),
      tx.pure.u64(options.rateToSupplierBps),
      tx.pure.u64(options.rateToTreasuryBps),
      tx.pure.u64(options.maximum),
      tx.pure.u64(options.minimum)
    ]
  })

  return tx
}

export async function createFlashLoanAssetPTB(options: FlashLoanAssetOptions) {
  const config = await resolveAdminConfig(options)
  const reserve = resolveReserveSelection(config, options)

  return createFlashLoanAssetRawPTB({
    ...options,
    config,
    maximum: encodeAmountInput(options.maximum, reserve.decimals),
    minimum: encodeAmountInput(options.minimum, reserve.decimals)
  })
}

export async function setFlashLoanAssetRateToSupplierBpsRawPTB(
  options: AdminPTBOptions &
    ReserveSelector & {
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_flash_loan_asset_rate_to_supplier'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.object(config.lending.flashloanConfig),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setFlashLoanAssetRateToSupplierBpsPTB = setFlashLoanAssetRateToSupplierBpsRawPTB

export async function setFlashLoanAssetRateToTreasuryBpsRawPTB(
  options: AdminPTBOptions &
    ReserveSelector & {
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_flash_loan_asset_rate_to_treasury'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.object(config.lending.flashloanConfig),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setFlashLoanAssetRateToTreasuryBpsPTB = setFlashLoanAssetRateToTreasuryBpsRawPTB

export const setFlashLoanAssetMinPTB = makeFlashLoanAmountSetter('set_flash_loan_asset_min')
export const setFlashLoanAssetMinRawPTB = makeFlashLoanAmountSetterRaw('set_flash_loan_asset_min')
export const setFlashLoanAssetMaxPTB = makeFlashLoanAmountSetter('set_flash_loan_asset_max')
export const setFlashLoanAssetMaxRawPTB = makeFlashLoanAmountSetterRaw('set_flash_loan_asset_max')
