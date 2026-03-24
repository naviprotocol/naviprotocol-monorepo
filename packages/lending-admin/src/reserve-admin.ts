import { encodeAmountInput, encodeRayRate } from './precision'
import {
  lendingTarget,
  resolveAdminPTBContext,
  resolveObjectArgument,
  resolveReserveSelection
} from './ptb'
import type { AmountInput, RayRateInput } from './types'
import type { AdminPTBOptions, PTBObjectArgument, ReserveSelector } from './ptb'

const PROTOCOL_AMOUNT_DECIMALS = 9

type ReserveOwnerSetterRawOptions = AdminPTBOptions & {
  assetId: number
  value: string
}

type ReserveRaySetterOptions = AdminPTBOptions & {
  assetId: number
  value: RayRateInput
}

type ReserveAmountSetterRawOptions = AdminPTBOptions & {
  assetId: number
  value: string
}

type ReserveAmountSetterOptions = AdminPTBOptions &
  ReserveSelector & {
    value: AmountInput
  }

type WithdrawTreasuryRawOptions = AdminPTBOptions &
  ReserveSelector & {
    amount: string
    recipient: string
  }

type WithdrawTreasuryOptions = AdminPTBOptions &
  ReserveSelector & {
    amount: AmountInput
    recipient: string
  }

type InitReserveRawOptions = AdminPTBOptions & {
  coinType: string
  coinMetadata: PTBObjectArgument
  oracleId: number
  isIsolated?: boolean
  supplyCap: string
  borrowCap: string
  baseRate: string
  optimalUtilization: string
  multiplier: string
  jumpRateMultiplier: string
  reserveFactor: string
  ltv: string
  treasuryFactor: string
  liquidationRatio: string
  liquidationBonus: string
  liquidationThreshold: string
}

type InitReserveOptions = AdminPTBOptions & {
  coinType: string
  coinMetadata: PTBObjectArgument
  oracleId: number
  isIsolated?: boolean
  supplyCap: AmountInput
  borrowCap: RayRateInput
  baseRate: RayRateInput
  optimalUtilization: RayRateInput
  multiplier: RayRateInput
  jumpRateMultiplier: RayRateInput
  reserveFactor: RayRateInput
  ltv: RayRateInput
  treasuryFactor: RayRateInput
  liquidationRatio: RayRateInput
  liquidationBonus: RayRateInput
  liquidationThreshold: RayRateInput
}

function makeReserveRaySetter(functionName: string, bounded = false) {
  return async (options: ReserveRaySetterOptions) => {
    const encoded = encodeRayRate(options.value, {
      bounded,
      fieldName: functionName
    })

    return makeReserveRaySetterRaw(functionName)({
      ...options,
      value: encoded
    })
  }
}

function makeReserveRaySetterRaw(functionName: string) {
  return async (options: ReserveOwnerSetterRawOptions) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: lendingTarget(config, 'storage', functionName),
      arguments: [
        tx.object(config.lending.ownerCap),
        tx.object(config.lending.storage),
        tx.pure.u8(options.assetId),
        tx.pure.u256(options.value)
      ]
    })

    return tx
  }
}

function makeReserveAmountSetter(functionName: string) {
  return async (options: ReserveAmountSetterOptions) => {
    const { config } = await resolveAdminPTBContext(options)
    const reserve = resolveReserveSelection(config, options)

    return makeReserveAmountSetterRaw(functionName)({
      ...options,
      config,
      assetId: reserve.assetId,
      value: encodeAmountInput(options.value, PROTOCOL_AMOUNT_DECIMALS)
    })
  }
}

function makeReserveAmountSetterRaw(functionName: string) {
  return async (options: ReserveAmountSetterRawOptions) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: lendingTarget(config, 'storage', functionName),
      arguments: [
        tx.object(config.lending.ownerCap),
        tx.object(config.lending.storage),
        tx.pure.u8(options.assetId),
        tx.pure.u256(options.value)
      ]
    })

    return tx
  }
}

export async function versionMigrateStoragePTB(options?: AdminPTBOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'version_migrate'),
    arguments: [tx.object(config.lending.storageAdminCap), tx.object(config.lending.storage)]
  })

  return tx
}

export async function initReserveRawPTB(options: InitReserveRawOptions) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'init_reserve'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.object(config.lending.poolAdminCap),
      tx.object(clock),
      tx.object(config.lending.storage),
      tx.pure.u8(options.oracleId),
      tx.pure.bool(options.isIsolated ?? false),
      tx.pure.u256(options.supplyCap),
      tx.pure.u256(options.borrowCap),
      tx.pure.u256(options.baseRate),
      tx.pure.u256(options.optimalUtilization),
      tx.pure.u256(options.multiplier),
      tx.pure.u256(options.jumpRateMultiplier),
      tx.pure.u256(options.reserveFactor),
      tx.pure.u256(options.ltv),
      tx.pure.u256(options.treasuryFactor),
      tx.pure.u256(options.liquidationRatio),
      tx.pure.u256(options.liquidationBonus),
      tx.pure.u256(options.liquidationThreshold),
      resolveObjectArgument(tx, options.coinMetadata)
    ]
  })

  return tx
}

export async function initReservePTB(options: InitReserveOptions) {
  return initReserveRawPTB({
    ...options,
    supplyCap: encodeAmountInput(options.supplyCap, PROTOCOL_AMOUNT_DECIMALS),
    borrowCap: encodeRayRate(options.borrowCap, {
      bounded: true,
      fieldName: 'borrowCap'
    }),
    baseRate: encodeRayRate(options.baseRate, { fieldName: 'baseRate' }),
    optimalUtilization: encodeRayRate(options.optimalUtilization, {
      bounded: true,
      fieldName: 'optimalUtilization'
    }),
    multiplier: encodeRayRate(options.multiplier, { fieldName: 'multiplier' }),
    jumpRateMultiplier: encodeRayRate(options.jumpRateMultiplier, {
      fieldName: 'jumpRateMultiplier'
    }),
    reserveFactor: encodeRayRate(options.reserveFactor, {
      bounded: true,
      fieldName: 'reserveFactor'
    }),
    ltv: encodeRayRate(options.ltv, {
      bounded: true,
      fieldName: 'ltv'
    }),
    treasuryFactor: encodeRayRate(options.treasuryFactor, {
      bounded: true,
      fieldName: 'treasuryFactor'
    }),
    liquidationRatio: encodeRayRate(options.liquidationRatio, {
      bounded: true,
      fieldName: 'liquidationRatio'
    }),
    liquidationBonus: encodeRayRate(options.liquidationBonus, {
      bounded: true,
      fieldName: 'liquidationBonus'
    }),
    liquidationThreshold: encodeRayRate(options.liquidationThreshold, {
      bounded: true,
      fieldName: 'liquidationThreshold'
    })
  })
}

export async function setPausePTB(options: AdminPTBOptions & { paused: boolean }) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'set_pause'),
    arguments: [
      tx.object(config.lending.ownerCap),
      tx.object(config.lending.storage),
      tx.pure.bool(options.paused)
    ]
  })

  return tx
}

export const setSupplyCapPTB = makeReserveAmountSetter('set_supply_cap')
export const setSupplyCapRawPTB = makeReserveAmountSetterRaw('set_supply_cap')
export const setBorrowCapPTB = makeReserveRaySetter('set_borrow_cap', true)
export const setBorrowCapRawPTB = makeReserveRaySetterRaw('set_borrow_cap')
export const setBaseRatePTB = makeReserveRaySetter('set_base_rate')
export const setBaseRateRawPTB = makeReserveRaySetterRaw('set_base_rate')
export const setMultiplierPTB = makeReserveRaySetter('set_multiplier')
export const setMultiplierRawPTB = makeReserveRaySetterRaw('set_multiplier')
export const setJumpRateMultiplierPTB = makeReserveRaySetter('set_jump_rate_multiplier')
export const setJumpRateMultiplierRawPTB = makeReserveRaySetterRaw('set_jump_rate_multiplier')
export const setReserveFactorPTB = makeReserveRaySetter('set_reserve_factor', true)
export const setReserveFactorRawPTB = makeReserveRaySetterRaw('set_reserve_factor')
export const setOptimalUtilizationPTB = makeReserveRaySetter('set_optimal_utilization', true)
export const setOptimalUtilizationRawPTB = makeReserveRaySetterRaw('set_optimal_utilization')
export const setLtvPTB = makeReserveRaySetter('set_ltv', true)
export const setLtvRawPTB = makeReserveRaySetterRaw('set_ltv')
export const setTreasuryFactorPTB = makeReserveRaySetter('set_treasury_factor', true)
export const setTreasuryFactorRawPTB = makeReserveRaySetterRaw('set_treasury_factor')
export const setLiquidationRatioPTB = makeReserveRaySetter('set_liquidation_ratio', true)
export const setLiquidationRatioRawPTB = makeReserveRaySetterRaw('set_liquidation_ratio')
export const setLiquidationBonusPTB = makeReserveRaySetter('set_liquidation_bonus', true)
export const setLiquidationBonusRawPTB = makeReserveRaySetterRaw('set_liquidation_bonus')
export const setLiquidationThresholdPTB = makeReserveRaySetter('set_liquidation_threshold', true)
export const setLiquidationThresholdRawPTB = makeReserveRaySetterRaw('set_liquidation_threshold')

export async function withdrawTreasuryRawPTB(options: WithdrawTreasuryRawOptions) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'withdraw_treasury_v2'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      tx.object(config.lending.poolAdminCap),
      tx.object(config.lending.storage),
      tx.pure.u8(reserve.assetId),
      tx.object(reserve.pool),
      tx.pure.u64(options.amount),
      tx.pure.address(options.recipient),
      tx.object(suiSystemState)
    ]
  })

  return tx
}

export async function withdrawTreasuryPTB(options: WithdrawTreasuryOptions) {
  const { config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  return withdrawTreasuryRawPTB({
    ...options,
    config,
    amount: encodeAmountInput(options.amount, reserve.decimals)
  })
}

export async function mintOwnerCapPTB(options: AdminPTBOptions & { recipient: string }) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'storage', 'mint_owner_cap'),
    arguments: [tx.object(config.lending.storageAdminCap), tx.pure.address(options.recipient)]
  })

  return tx
}
