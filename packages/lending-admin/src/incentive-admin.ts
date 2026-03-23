import { Transaction } from '@mysten/sui/transactions'
import { DEFAULT_CACHE_TIME, getAdminConfig } from './config'
import type {
  IncentiveRewardRateParams,
  IncentiveRuleCreateParams,
  ResolveConfigOptions,
  RewardFundDepositParams,
  RewardFundInitForMarketParams,
  RewardFundPoolCreateParams,
  RewardFundWithdrawParams
} from './types'
import { parseTxValue } from './utils'

/**
 * Creates a new incentive V3 object bound to a storage object.
 */
export async function createIncentiveV3WithStoragePTB(
  tx: Transaction,
  storage: string,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::create_incentive_v3_with_storage`,
    arguments: [tx.object(options.incentiveOwner || config.incentiveOwner), tx.object(storage)]
  })

  return tx
}

/**
 * Creates an incentive V3 pool for a specific asset.
 */
export async function createIncentivePoolPTB(
  tx: Transaction,
  assetId: number,
  assetType: string,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::create_incentive_v3_pool`,
    typeArguments: [assetType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(options.incentiveV3 || config.incentiveV3),
      tx.object(options?.storage || config.storage),
      tx.pure.u8(assetId)
    ]
  })

  return tx
}

/**
 * Creates an incentive V3 rule.
 */
export async function createIncentiveRulePTB(
  tx: Transaction,
  params: IncentiveRuleCreateParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::create_incentive_v3_rule`,
    typeArguments: [params.assetType, params.rewardType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object('0x06'),
      tx.object(options.incentiveV3 || config.incentiveV3),
      tx.pure.u8(params.option)
    ]
  })

  return tx
}

/**
 * Sets incentive V3 reward rate by rule id.
 */
export async function setIncentiveRewardRatePTB(
  tx: Transaction,
  params: IncentiveRewardRateParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::set_incentive_v3_reward_rate_by_rule_id`,
    typeArguments: [params.assetType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object('0x06'),
      tx.object(options.incentiveV3 || config.incentiveV3),
      tx.object(options?.storage || config.storage),
      tx.pure.address(params.ruleId),
      tx.pure.u64(params.supplyAmount),
      tx.pure.u64(params.supplyDuration)
    ]
  })

  return tx
}

/**
 * Creates an incentive reward fund pool bound to storage.
 */
export async function createRewardFundPoolPTB(
  tx: Transaction,
  params: RewardFundPoolCreateParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::create_incentive_v3_reward_fund_with_storage`,
    typeArguments: [params.rewardFundType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(options?.storage || config.storage)
    ]
  })

  return tx
}

/**
 * Deposits reward token coins to a reward fund.
 */
export async function depositRewardFundPTB(
  tx: Transaction,
  params: RewardFundDepositParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::manage::deposit_incentive_v3_reward_fund`,
    typeArguments: [params.rewardFundType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(params.rewardFundId),
      parseTxValue(params.coin, tx.object),
      tx.pure.u64(params.amount)
    ]
  })

  return tx
}

/**
 * Initializes a reward fund for the current market.
 */
export async function initRewardFundForMarketPTB(
  tx: Transaction,
  params: RewardFundInitForMarketParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v3::init_fund_for_market`,
    typeArguments: [params.rewardFundType],
    arguments: [
      tx.object(options.storageAdminCap || config.storageAdminCap),
      tx.object(params.rewardFundId)
    ]
  })

  return tx
}

/**
 * Withdraws funds from incentive v2 pool.
 */
export async function withdrawRewardFundPTB(
  tx: Transaction,
  params: RewardFundWithdrawParams,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v2::withdraw_funds`,
    typeArguments: [params.fundType],
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(params.fundsObjectId),
      tx.pure.u64(params.value)
    ]
  })

  return tx
}

/**
 * Freezes an incentive v2 pool until a deadline.
 */
export async function freezeIncentivePoolPTB(
  tx: Transaction,
  deadline: number,
  options: ResolveConfigOptions = {}
): Promise<Transaction> {
  const config = await getAdminConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  tx.moveCall({
    target: `${config.package}::incentive_v2::freeze_incentive_pool`,
    arguments: [
      tx.object(options.incentiveOwner || config.incentiveOwner),
      tx.object(options.incentiveV2 || config.incentiveV2),
      tx.pure.u64(deadline)
    ]
  })

  return tx
}
