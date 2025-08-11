/**
 * Lending Reward Management for Lending Protocol
 *
 * This module provides comprehensive reward functionality for the lending protocol.
 * It handles reward calculations, claiming, and management for users who participate
 * in lending activities such as supplying assets or borrowing.
 */

import type {
  SuiClientOption,
  EnvOption,
  LendingRewardSummary,
  LendingReward,
  HistoryClaimedReward,
  LendingClaimedReward,
  TransactionResult,
  AccountCapOption,
  AccountCap
} from './types'
import { Transaction } from '@mysten/sui/transactions'
import { getConfig, DEFAULT_CACHE_TIME } from './config'
import {
  suiClient,
  camelize,
  parseDevInspectResult,
  normalizeCoinType,
  withSingleton,
  parseTxValue
} from './utils'
import { bcs } from '@mysten/sui/bcs'
import { getPriceFeeds } from './oracle'
import { getPools, depositCoinPTB } from './pool'

/**
 * Get user's available lending rewards
 *
 * This function retrieves all available rewards for a user from the lending protocol.
 * It uses devInspect to simulate the reward calculation and returns detailed
 * information about claimable rewards for each asset and reward type.
 *
 * @param address - User's wallet address or account cap
 * @param options - Optional client and environment configuration
 * @returns Array of lending rewards available for claiming
 */
export async function getUserAvailableLendingRewards(
  address: string | AccountCap,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<LendingReward[]> {
  const feeds = await getPriceFeeds(options)
  const pools = await getPools(options)
  const client = options?.client ?? suiClient
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  // Create transaction to simulate reward calculation
  const tx = new Transaction()
  tx.moveCall({
    target: `${config.uiGetter}::incentive_v3_getter::get_user_atomic_claimable_rewards`,
    arguments: [
      tx.object('0x06'), // Clock object
      tx.object(config.storage), // Protocol storage
      tx.object(config.incentiveV3), // Incentive V3 contract
      tx.pure.address(address) // User address
    ]
  })

  // Simulate the transaction to get reward data
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })

  // Parse the result using BCS schemas
  const rewardsData = parseDevInspectResult<[string[], string[], number[], string[], number[]]>(
    result,
    [
      bcs.vector(bcs.string()), // Asset coin types
      bcs.vector(bcs.string()), // Reward coin types
      bcs.vector(bcs.u8()), // Reward options
      bcs.vector(bcs.Address), // Rule IDs
      bcs.vector(bcs.u256()) // Claimable amounts
    ]
  )

  const rewardsList: {
    userClaimableReward: number
    userClaimedReward?: string
    option: number
    ruleIds: string[]
    assetCoinType: string
    rewardCoinType: string
    assetId: number
  }[] = []

  // Process the reward data and match with feeds and pools
  if (rewardsData.length === 5 && Array.isArray(rewardsData[0])) {
    const count = rewardsData[0].length
    for (let i = 0; i < count; i++) {
      const feed = feeds.find(
        (feed) => normalizeCoinType(feed.coinType) === normalizeCoinType(rewardsData[1][i])
      )
      const pool = pools.find(
        (pool) => normalizeCoinType(pool.coinType) === normalizeCoinType(rewardsData[0][i])
      )
      if (!feed || !pool) {
        continue
      }
      rewardsList.push({
        assetId: pool.id,
        assetCoinType: normalizeCoinType(rewardsData[0][i]),
        rewardCoinType: normalizeCoinType(rewardsData[1][i]),
        option: Number(rewardsData[2][i]),
        userClaimableReward: Number(rewardsData[4][i]) / Math.pow(10, feed.priceDecimal),
        ruleIds: Array.isArray(rewardsData[3][i]) ? (rewardsData[3][i] as any) : [rewardsData[3][i]]
      })
    }
  }
  return rewardsList
}

/**
 * Summarize lending rewards by asset and reward type
 *
 * This function aggregates rewards by asset ID and reward type, providing
 * a summary view of all available rewards for easier display and management.
 *
 * @param rewards - Array of lending rewards to summarize
 * @returns Array of summarized reward information grouped by asset and type
 */
export function summaryLendingRewards(rewards: LendingReward[]): LendingRewardSummary[] {
  // Aggregate rewards by asset ID, reward type, and coin type
  const agg = new Map<
    string,
    { assetId: number; rewardType: number; coinType: string; total: number }
  >()

  rewards.forEach((reward) => {
    const assetId = reward.assetId
    const rewardType = reward.option
    const key = `${assetId}-${rewardType}-${reward.rewardCoinType}`
    if (agg.has(key)) {
      agg.get(key)!.total += reward.userClaimableReward
    } else {
      agg.set(key, {
        assetId,
        rewardType,
        coinType: reward.rewardCoinType,
        total: Number(reward.userClaimableReward)
      })
    }
  })

  // Group rewards by asset ID and reward type
  const groupMap = new Map<
    string,
    { assetId: number; rewardType: number; rewards: Map<string, number> }
  >()
  for (const { assetId, rewardType, coinType, total } of agg.values()) {
    const groupKey = `${assetId}-${rewardType}`
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { assetId, rewardType, rewards: new Map<string, number>() })
    }
    const rewardMap = groupMap.get(groupKey)!
    rewardMap.rewards.set(coinType, (rewardMap.rewards.get(coinType) || 0) + total)
  }

  // Convert to summary format
  return Array.from(groupMap.values()).map((group) => ({
    assetId: group.assetId,
    rewardType: group.rewardType,
    rewards: Array.from(group.rewards.entries()).map(([coinType, available]) => ({
      coinType,
      available: available.toFixed(6)
    }))
  }))
}

/**
 * Get user's total claimed rewards in USD value
 *
 * Fetches the total amount of rewards that a user has claimed historically,
 * converted to USD value for easy comparison and display.
 *
 * @param address - User's wallet address or account cap
 * @returns Object containing total claimed rewards in USD
 */
export const getUserTotalClaimedReward = withSingleton(
  async (
    address: string | AccountCap
  ): Promise<{
    USDValue: number
  }> => {
    const url = `https://open-api.naviprotocol.io/api/navi/user/total_claimed_reward?userAddress=${address}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  }
)

/**
 * Get user's claimed reward history
 *
 * Retrieves a paginated list of all rewards that a user has claimed historically.
 * Useful for tracking reward history and generating reports.
 *
 * @param address - User's wallet address or account cap
 * @param options - Pagination options (page number and size)
 * @returns Object containing claimed reward history and pagination cursor
 */
export const getUserClaimedRewardHistory = withSingleton(
  async (
    address: string | AccountCap,
    options?: {
      page?: number
      size?: number
    }
  ): Promise<{
    data: HistoryClaimedReward[]
    cursor?: string
  }> => {
    const endpoint = `https://open-api.naviprotocol.io/api/navi/user/rewards?userAddress=${address}&page=${options?.page || 1}&pageSize=${options?.size || 400}`
    const res = await fetch(endpoint).then((res) => res.json())
    return camelize({
      data: res.data.rewards
    })
  }
)

/**
 * Claim lending rewards in the PTB (Programmable Transaction Block)
 *
 * This function adds operations to a transaction block to claim rewards from the lending protocol.
 * It supports different claiming methods including direct claiming, claiming with
 * account capabilities, and custom coin handling (transfer or deposit).
 *
 * @param tx - The transaction block to add reward claiming operations to
 * @param rewards - Array of rewards to claim
 * @param options - Optional configuration including account capabilities and custom coin handling
 * @returns Array of claimed reward coins and their identifiers
 * @throws Error if reward fund not found or invalid configuration
 */
export async function claimLendingRewardsPTB(
  tx: Transaction,
  rewards: LendingReward[],
  options?: Partial<
    EnvOption &
      AccountCapOption & {
        customCoinReceive?: {
          type: 'transfer' | 'depositNAVI' | 'skip'
          transfer?: string | TransactionResult
        }
      }
  >
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const pools = await getPools({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  // Group rewards by reward coin type and collect asset IDs and rule IDs
  const rewardMap = new Map<string, { assetIds: string[]; ruleIds: string[] }>()

  for (const reward of rewards) {
    const { rewardCoinType, ruleIds } = reward

    for (const ruleId of ruleIds) {
      if (!rewardMap.has(rewardCoinType)) {
        rewardMap.set(rewardCoinType, { assetIds: [], ruleIds: [] })
      }

      const group = rewardMap.get(rewardCoinType)!
      group.assetIds.push(reward.assetCoinType.replace('0x', ''))
      group.ruleIds.push(ruleId)
    }
  }

  const rewardCoins = [] as LendingClaimedReward[]

  // Process each reward coin type
  for (const [rewardCoinType, { assetIds, ruleIds }] of rewardMap) {
    const pool = pools.find(
      (p) => normalizeCoinType(p.suiCoinType) === normalizeCoinType(rewardCoinType)
    )
    if (!pool || !pool.contract.rewardFundId) {
      throw new Error(`No matching rewardFund found for reward coin: ${rewardCoinType}`)
    }
    const matchedRewardFund = pool.contract.rewardFundId

    // Validate configuration
    if (options?.accountCap && !options.customCoinReceive) {
      throw new Error('customCoinReceive is required when accountCap is provided')
    }

    // Handle custom coin receiving logic
    if (options?.customCoinReceive) {
      let rewardBalance

      // Claim rewards with or without account capability
      if (options.accountCap) {
        rewardBalance = tx.moveCall({
          target: `${config.package}::incentive_v3::claim_reward_with_account_cap`,
          arguments: [
            tx.object('0x06'), // Clock object
            tx.object(config.incentiveV3), // Incentive V3 contract
            tx.object(config.storage), // Protocol storage
            tx.object(matchedRewardFund), // Reward fund
            tx.pure.vector('string', assetIds), // Asset IDs
            tx.pure.vector('address', ruleIds), // Rule IDs
            parseTxValue(options.accountCap, tx.object) // Account capability
          ],
          typeArguments: [rewardCoinType]
        })
      } else {
        rewardBalance = tx.moveCall({
          target: `${config.package}::incentive_v3::claim_reward`,
          arguments: [
            tx.object('0x06'), // Clock object
            tx.object(config.incentiveV3), // Incentive V3 contract
            tx.object(config.storage), // Protocol storage
            tx.object(matchedRewardFund), // Reward fund
            tx.pure.vector('string', assetIds), // Asset IDs
            tx.pure.vector('address', ruleIds) // Rule IDs
          ],
          typeArguments: [rewardCoinType]
        })
      }

      // Convert balance to coin object
      const [rewardCoin]: any = tx.moveCall({
        target: '0x2::coin::from_balance',
        arguments: [rewardBalance],
        typeArguments: [rewardCoinType]
      })

      // Handle different custom coin receiving types
      if (options?.customCoinReceive.type === 'transfer') {
        if (!options.customCoinReceive.transfer) {
          throw new Error('customCoinReceive.transfer is required')
        }
        tx.transferObjects(
          [rewardCoin],
          parseTxValue(options.customCoinReceive.transfer, tx.pure.address)
        )
      }
      if (options?.customCoinReceive.type === 'depositNAVI') {
        // {formatAmount(reserveData?.totalSupplyAmount, Default_Decimals)}{' '}
        // <span style={{ fontWeight: 400, color: 'white', opacity: 0.5 }}>of</span>{' '}
        // {formatAmount(reserveData?.supplyCapCeiling, Rate_Decimals)}
        await depositCoinPTB(tx, pool, rewardCoin, options)
      } else {
        rewardCoins.push({
          coin: rewardCoin,
          identifier: pool
        })
      }
    } else {
      // Standard reward claiming without custom handling
      tx.moveCall({
        target: `${config.package}::incentive_v3::claim_reward_entry`,
        arguments: [
          tx.object('0x06'), // Clock object
          tx.object(config.incentiveV3), // Incentive V3 contract
          tx.object(config.storage), // Protocol storage
          tx.object(matchedRewardFund), // Reward fund
          tx.pure.vector('string', assetIds), // Asset IDs
          tx.pure.vector('address', ruleIds) // Rule IDs
        ],
        typeArguments: [rewardCoinType]
      })
    }
  }
  return rewardCoins
}
