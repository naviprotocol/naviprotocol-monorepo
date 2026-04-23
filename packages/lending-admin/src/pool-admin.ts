import { bcs } from '@mysten/sui/bcs'
import { encodeAmountInput } from './precision'
import {
  lendingTarget,
  resolveAdminConfig,
  resolveAdminPTBContext,
  resolveObjectArgument,
  resolveReserveSelection,
  resolveSuiReserve
} from './ptb'
import type { AmountInput } from './types'
import type { AdminPTBOptions, PTBObjectArgument, ReserveSelector } from './ptb'

type PoolSelector = ReserveSelector & {
  pool?: PTBObjectArgument
}

type PoolTreasuryRawOptions = AdminPTBOptions &
  PoolSelector & {
    amount: string
    recipient: string
  }

type PoolTreasuryOptions = AdminPTBOptions &
  PoolSelector & {
    amount: AmountInput
    recipient: string
  }

type SuiPoolOptions = AdminPTBOptions & {
  pool?: PTBObjectArgument
}

type SuiTargetRawOptions = SuiPoolOptions & {
  targetSuiAmount: string
}

type SuiTargetOptions = SuiPoolOptions & {
  targetSuiAmount: AmountInput
}

type ValidatorWeight = {
  validator: string
  weight: string
}

const validatorWeightsBcs = bcs.struct('VecMapAddressU64', {
  contents: bcs.vector(
    bcs.struct('EntryAddressU64', {
      key: bcs.Address,
      value: bcs.u64()
    })
  )
})

function serializeValidatorWeights(weights: ValidatorWeight[]) {
  return validatorWeightsBcs.serialize({
    contents: weights.map((weight) => ({
      key: weight.validator,
      value: weight.weight
    }))
  })
}

function resolvePoolObject(
  tx: Awaited<ReturnType<typeof resolveAdminPTBContext>>['tx'],
  pool: PTBObjectArgument | undefined,
  fallbackPool: string
) {
  return resolveObjectArgument(tx, pool ?? fallbackPool)
}

export async function initPoolForMainMarketPTB(options: AdminPTBOptions & PoolSelector) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'init_pool_for_main_market'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool)
    ]
  })

  return tx
}

export async function withdrawPoolTreasuryRawPTB(options: PoolTreasuryRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'withdraw_treasury'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool),
      tx.pure.u64(options.amount),
      tx.pure.address(options.recipient)
    ]
  })

  return tx
}

export async function withdrawPoolTreasuryPTB(options: PoolTreasuryOptions) {
  const config = await resolveAdminConfig(options)
  const reserve = resolveReserveSelection(config, options)

  return withdrawPoolTreasuryRawPTB({
    ...options,
    config,
    amount: encodeAmountInput(options.amount, reserve.decimals)
  })
}

export async function initSuiPoolManagerRawPTB(
  options: SuiPoolOptions & {
    stakePool: PTBObjectArgument
    metadata: PTBObjectArgument
    targetSuiAmount: string
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'init_sui_pool_manager'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool),
      resolveObjectArgument(tx, options.stakePool),
      resolveObjectArgument(tx, options.metadata),
      tx.pure.u64(options.targetSuiAmount)
    ]
  })

  return tx
}

export async function initSuiPoolManagerPTB(
  options: SuiPoolOptions & {
    stakePool: PTBObjectArgument
    metadata: PTBObjectArgument
    targetSuiAmount: AmountInput
  }
) {
  const config = await resolveAdminConfig(options)
  const reserve = resolveSuiReserve(config)

  return initSuiPoolManagerRawPTB({
    ...options,
    config,
    targetSuiAmount: encodeAmountInput(options.targetSuiAmount, reserve.decimals)
  })
}

export async function enableSuiPoolManagerPTB(options?: SuiPoolOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'enable_manage'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options?.pool, reserve.pool)
    ]
  })

  return tx
}

export async function disableSuiPoolManagerPTB(options?: SuiPoolOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'disable_manage'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options?.pool, reserve.pool)
    ]
  })

  return tx
}

export async function refreshSuiStakePTB(options?: SuiPoolOptions) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'refresh_stake'),
    arguments: [resolvePoolObject(tx, options?.pool, reserve.pool), tx.object(suiSystemState)]
  })

  return tx
}

export async function withdrawVsuiFromTreasuryPTB(
  options: SuiPoolOptions & {
    recipient: string
  }
) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'withdraw_vsui_from_treasury'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool),
      tx.pure.address(options.recipient),
      tx.object(suiSystemState)
    ]
  })

  return tx
}

export async function setTargetSuiAmountRawPTB(options: SuiTargetRawOptions) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'set_target_sui_amount'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool),
      tx.pure.u64(options.targetSuiAmount),
      tx.object(suiSystemState)
    ]
  })

  return tx
}

export async function setTargetSuiAmountPTB(options: SuiTargetOptions) {
  const config = await resolveAdminConfig(options)
  const reserve = resolveSuiReserve(config)

  return setTargetSuiAmountRawPTB({
    ...options,
    config,
    targetSuiAmount: encodeAmountInput(options.targetSuiAmount, reserve.decimals)
  })
}

export async function unstakeVsuiPTB(
  options: SuiPoolOptions & {
    vsuiCoin: PTBObjectArgument
  }
) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)
  const [suiCoin] = tx.moveCall({
    target: lendingTarget(config, 'pool', 'unstake_vsui'),
    arguments: [
      resolvePoolObject(tx, options.pool, reserve.pool),
      tx.object(suiSystemState),
      resolveObjectArgument(tx, options.vsuiCoin)
    ]
  })

  return { tx, suiCoin }
}

export async function setValidatorWeightsVsuiPTB(
  options: SuiPoolOptions & {
    vsuiOperatorCap: PTBObjectArgument
    validatorWeights: ValidatorWeight[]
  }
) {
  const { tx, config, suiSystemState } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'set_validator_weights_vsui'),
    arguments: [
      resolvePoolObject(tx, options.pool, reserve.pool),
      tx.object(suiSystemState),
      resolveObjectArgument(tx, options.vsuiOperatorCap),
      tx.pure(serializeValidatorWeights(options.validatorWeights))
    ]
  })

  return tx
}

export async function directDepositSuiPTB(
  options: SuiPoolOptions & {
    suiCoin: PTBObjectArgument
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveSuiReserve(config)

  tx.moveCall({
    target: lendingTarget(config, 'pool', 'direct_deposit_sui'),
    arguments: [
      tx.object(config.lending.poolAdminCap),
      resolvePoolObject(tx, options.pool, reserve.pool),
      resolveObjectArgument(tx, options.suiCoin)
    ]
  })

  return tx
}
