import { encodeAmountInput } from './precision'
import {
  lendingTarget,
  resolveAdminConfig,
  resolveAdminPTBContext,
  resolveObjectArgument,
  resolveReserveSelection
} from './ptb'
import { getReserveByCoinType } from './resolvers'
import type { AmountInput } from './types'
import type { AdminPTBOptions, PTBObjectArgument, ReserveSelector } from './ptb'

type IncentiveObjects = {
  storage?: PTBObjectArgument
  incentive?: PTBObjectArgument
}

type RewardFundObjects = {
  rewardFund: PTBObjectArgument
}

type CoinAmountResolution = {
  coinType: string
  decimals?: number
}

type IncentiveAmountRawOptions = AdminPTBOptions &
  IncentiveObjects &
  CoinAmountResolution & {
    amount: string
    recipient: string
  }

type IncentiveAmountOptions = AdminPTBOptions &
  IncentiveObjects &
  CoinAmountResolution & {
    amount: AmountInput
    recipient: string
  }

type RewardFundAmountRawOptions = AdminPTBOptions &
  RewardFundObjects &
  CoinAmountResolution & {
    depositCoin: PTBObjectArgument
    amount: string
  }

type RewardFundAmountOptions = AdminPTBOptions &
  RewardFundObjects &
  CoinAmountResolution & {
    depositCoin: PTBObjectArgument
    amount: AmountInput
  }

type RewardFundWithdrawRawOptions = AdminPTBOptions &
  RewardFundObjects &
  CoinAmountResolution & {
    amount: string
    recipient: string
  }

type RewardFundWithdrawOptions = AdminPTBOptions &
  RewardFundObjects &
  CoinAmountResolution & {
    amount: AmountInput
    recipient: string
  }

type RuleRateRawOptions = AdminPTBOptions &
  IncentiveObjects &
  ReserveSelector & {
    ruleId: string
    totalSupply: string
    durationMs: string
  }

type RewardRateAmountResolution = {
  rewardCoinType?: string
  rewardDecimals?: number
}

type RuleRateOptions = AdminPTBOptions &
  IncentiveObjects &
  ReserveSelector &
  RewardRateAmountResolution & {
    ruleId: string
    totalSupply: AmountInput
    durationMs: string
  }

function resolveAmountDecimals(
  config: Awaited<ReturnType<typeof resolveAdminPTBContext>>['config'],
  options: CoinAmountResolution
) {
  if (typeof options.decimals === 'number') {
    return options.decimals
  }

  return resolveReserveSelection(config, { coinType: options.coinType }).decimals
}

function resolveRewardAmountDecimals(
  config: Awaited<ReturnType<typeof resolveAdminPTBContext>>['config'],
  options: RewardRateAmountResolution
) {
  if (typeof options.rewardDecimals === 'number') {
    return options.rewardDecimals
  }

  if (options.rewardCoinType) {
    return getReserveByCoinType(config, options.rewardCoinType).decimals
  }

  throw new Error('token reward totalSupply requires rewardCoinType or rewardDecimals')
}

function encodeRewardTotalSupply(
  config: Awaited<ReturnType<typeof resolveAdminPTBContext>>['config'],
  options: Pick<RuleRateOptions, 'rewardCoinType' | 'rewardDecimals' | 'totalSupply'>
) {
  if (options.totalSupply.unit === 'atomic') {
    return encodeAmountInput(options.totalSupply, 0)
  }

  return encodeAmountInput(options.totalSupply, resolveRewardAmountDecimals(config, options))
}

export async function createIncentiveV3PTB(
  options?: AdminPTBOptions & { storage?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_incentive_v3_with_storage'),
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      resolveObjectArgument(tx, options?.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function incentiveV3VersionMigratePTB(
  options?: AdminPTBOptions & { incentive?: PTBObjectArgument }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'incentive_v3_version_migrate'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options?.incentive ?? config.lending.incentiveV3)
    ]
  })

  return tx
}

export async function createIncentiveV3RewardFundPTB(
  options: AdminPTBOptions & {
    coinType: string
    storage?: PTBObjectArgument
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_incentive_v3_reward_fund_with_storage'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage)
    ]
  })

  return tx
}

export async function depositIncentiveV3RewardFundRawPTB(options: RewardFundAmountRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'deposit_incentive_v3_reward_fund'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      resolveObjectArgument(tx, options.rewardFund),
      resolveObjectArgument(tx, options.depositCoin),
      tx.pure.u64(options.amount)
    ]
  })

  return tx
}

export async function depositIncentiveV3RewardFundPTB(options: RewardFundAmountOptions) {
  const config = await resolveAdminConfig(options)

  return depositIncentiveV3RewardFundRawPTB({
    ...options,
    config,
    amount: encodeAmountInput(options.amount, resolveAmountDecimals(config, options))
  })
}

export async function withdrawIncentiveV3RewardFundRawPTB(options: RewardFundWithdrawRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'withdraw_incentive_v3_reward_fund'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.rewardFund),
      tx.pure.u64(options.amount),
      tx.pure.address(options.recipient)
    ]
  })

  return tx
}

export async function withdrawIncentiveV3RewardFundPTB(options: RewardFundWithdrawOptions) {
  const config = await resolveAdminConfig(options)

  return withdrawIncentiveV3RewardFundRawPTB({
    ...options,
    config,
    amount: encodeAmountInput(options.amount, resolveAmountDecimals(config, options))
  })
}

export async function createIncentiveV3PoolPTB(
  options: AdminPTBOptions & IncentiveObjects & ReserveSelector
) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_incentive_v3_pool'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.u8(reserve.assetId)
    ]
  })

  return tx
}

export async function createIncentiveV3RulePTB(
  options: AdminPTBOptions &
    IncentiveObjects &
    ReserveSelector & {
      rewardCoinType: string
      option: number
    }
) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'create_incentive_v3_rule'),
    typeArguments: [reserve.coinType, options.rewardCoinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      tx.object(clock),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u8(options.option)
    ]
  })

  return tx
}

function makeRuleToggle(functionName: string) {
  return async (
    options: AdminPTBOptions &
      IncentiveObjects &
      ReserveSelector & {
        ruleId: string
      }
  ) => {
    const { tx, config } = await resolveAdminPTBContext(options)
    const reserve = resolveReserveSelection(config, options)

    tx.moveCall({
      target: lendingTarget(config, 'manage', functionName),
      typeArguments: [reserve.coinType],
      arguments: [
        tx.object(config.lending.incentiveOwnerCap),
        resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
        tx.pure.address(options.ruleId)
      ]
    })

    return tx
  }
}

export const enableIncentiveV3ByRuleIdPTB = makeRuleToggle('enable_incentive_v3_by_rule_id')
export const disableIncentiveV3ByRuleIdPTB = makeRuleToggle('disable_incentive_v3_by_rule_id')

export async function setIncentiveV3RewardRateByRuleIdRawPTB(options: RuleRateRawOptions) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_incentive_v3_reward_rate_by_rule_id'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      tx.object(clock),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      resolveObjectArgument(tx, options.storage ?? config.lending.storage),
      tx.pure.address(options.ruleId),
      tx.pure.u64(options.totalSupply),
      tx.pure.u64(options.durationMs)
    ]
  })

  return tx
}

/**
 * Sets a rule reward rate from a reward-token amount distributed over `durationMs`.
 *
 * When `totalSupply.unit === 'token'`, pass `rewardCoinType` to resolve decimals from
 * config metadata, or `rewardDecimals` for non-reserve reward tokens. Use the Raw variant
 * to send a pre-encoded atomic amount directly.
 */
export async function setIncentiveV3RewardRateByRuleIdPTB(options: RuleRateOptions) {
  const config = await resolveAdminConfig(options)

  return setIncentiveV3RewardRateByRuleIdRawPTB({
    ...options,
    config,
    totalSupply: encodeRewardTotalSupply(config, options)
  })
}

export async function setIncentiveV3MaxRewardRateByRuleIdRawPTB(options: RuleRateRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const reserve = resolveReserveSelection(config, options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_incentive_v3_max_reward_rate_by_rule_id'),
    typeArguments: [reserve.coinType],
    arguments: [
      tx.object(config.lending.incentiveOwnerCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.address(options.ruleId),
      tx.pure.u64(options.totalSupply),
      tx.pure.u64(options.durationMs)
    ]
  })

  return tx
}

/**
 * Sets the maximum allowed rule reward rate from a reward-token amount over `durationMs`.
 *
 * When `totalSupply.unit === 'token'`, pass `rewardCoinType` to resolve decimals from
 * config metadata, or `rewardDecimals` for non-reserve reward tokens. Use the Raw variant
 * to send a pre-encoded atomic amount directly.
 */
export async function setIncentiveV3MaxRewardRateByRuleIdPTB(options: RuleRateOptions) {
  const config = await resolveAdminConfig(options)

  return setIncentiveV3MaxRewardRateByRuleIdRawPTB({
    ...options,
    config,
    totalSupply: encodeRewardTotalSupply(config, options)
  })
}

export async function setIncentiveV3BorrowFeeRateBpsRawPTB(
  options: AdminPTBOptions &
    IncentiveObjects & {
      value: string
    }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'set_incentive_v3_borrow_fee_rate'),
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export const setIncentiveV3BorrowFeeRateBpsPTB = setIncentiveV3BorrowFeeRateBpsRawPTB

export async function withdrawBorrowFeeRawPTB(options: IncentiveAmountRawOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: lendingTarget(config, 'manage', 'withdraw_borrow_fee'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.lending.storageAdminCap),
      resolveObjectArgument(tx, options.incentive ?? config.lending.incentiveV3),
      tx.pure.u64(options.amount),
      tx.pure.address(options.recipient)
    ]
  })

  return tx
}

export async function withdrawBorrowFeePTB(options: IncentiveAmountOptions) {
  const config = await resolveAdminConfig(options)

  return withdrawBorrowFeeRawPTB({
    ...options,
    config,
    amount: encodeAmountInput(options.amount, resolveAmountDecimals(config, options))
  })
}
