import type {
  UserLendingInfo,
  SuiClientOption,
  EnvOption,
  Pool,
  LendingReward,
  Transaction,
  HistoryClaimedReward
} from './types'
import { Transaction as SuiTransaction } from '@mysten/sui/transactions'
import { UserStateInfo } from './bcs'
import { getConfig, DEFAULT_CACHE_TIME } from './config'
import {
  suiClient,
  camelize,
  parseDevInspectResult,
  normalizeCoinType,
  withSingleton,
  processContractHealthFactor
} from './utils'
import { bcs } from '@mysten/sui/bcs'
import { getHealthFactorPTB, getDynamicHealthFactorPTB } from './ptb'
import { getPriceFeeds } from './oracle'
import { getPools, PoolOperator } from './pool'

export async function getUserLendingState(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<UserLendingInfo[]> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const tx = new SuiTransaction()
  const client = options?.client ?? suiClient
  tx.moveCall({
    target: `${config.uiGetter}::getter::get_user_state`,
    arguments: [tx.object(config.storage), tx.pure.address(address!)]
  })
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<
    {
      supply_balance: string
      borrow_balance: string
      asset_id: number
    }[][]
  >(result, [bcs.vector(UserStateInfo)])
  return camelize(
    res[0].filter((item) => {
      return item.supply_balance !== '0' || item.borrow_balance !== '0'
    })
  ) as any
}

export async function getUserHealthFactor(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  const client = options?.client ?? suiClient
  const tx = new SuiTransaction()
  await getHealthFactorPTB(tx, address, options)
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<number[]>(result, [bcs.u256()])
  return processContractHealthFactor(Number(res[0]) || 0)
}

export async function getUserDynamicHealthFactorAfterOperator(
  address: string,
  pool: Pool,
  operations: {
    type: PoolOperator
    amount: number
  }[],
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  const client = options?.client ?? suiClient
  const tx = new SuiTransaction()
  let estimatedSupply = 0
  let estimatedBorrow = 0
  operations.forEach((operation) => {
    if (operation.type === PoolOperator.Supply) {
      estimatedSupply += operation.amount
    } else if (operation.type === PoolOperator.Withdraw) {
      estimatedSupply -= operation.amount
    } else if (operation.type === PoolOperator.Borrow) {
      estimatedBorrow += operation.amount
    } else if (operation.type === PoolOperator.Repay) {
      estimatedBorrow -= operation.amount
    }
  })
  if (estimatedSupply * estimatedBorrow < 0) {
    throw new Error('Invalid operations')
  }
  const isIncrease = estimatedSupply > 0 || estimatedBorrow > 0
  await getDynamicHealthFactorPTB(
    tx,
    address,
    pool,
    Math.abs(estimatedSupply),
    Math.abs(estimatedBorrow),
    isIncrease,
    options
  )
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const res = parseDevInspectResult<number[]>(result, [bcs.u256()])
  return processContractHealthFactor(Number(res[0]) || 0)
}

export async function getUserAvailableLendingRewards(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<LendingReward[]> {
  const feeds = await getPriceFeeds(options)
  const pools = await getPools(options)
  const client = options?.client ?? suiClient
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const tx = new SuiTransaction()
  tx.moveCall({
    target: `${config.uiGetter}::incentive_v3_getter::get_user_atomic_claimable_rewards`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(config.incentiveV3),
      tx.pure.address(address)
    ]
  })
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: address
  })
  const rewardsData = parseDevInspectResult<[string[], string[], number[], string[], number[]]>(
    result,
    [
      bcs.vector(bcs.string()),
      bcs.vector(bcs.string()),
      bcs.vector(bcs.u8()),
      bcs.vector(bcs.Address),
      bcs.vector(bcs.u256())
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
  if (rewardsData.length === 5 && Array.isArray(rewardsData[0])) {
    const count = rewardsData[0].length
    for (let i = 0; i < count; i++) {
      const feed = feeds.find(
        (feed) => normalizeCoinType(feed.coinType) === normalizeCoinType(rewardsData[0][i])
      )
      const pool = pools.find(
        (pool) => normalizeCoinType(pool.coinType) === normalizeCoinType(rewardsData[0][i])
      )
      if (!feed || !pool) {
        continue
      }
      rewardsList.push({
        assetId: pool.id,
        assetCoinType: rewardsData[0][i],
        rewardCoinType: rewardsData[1][i],
        option: Number(rewardsData[2][i]),
        userClaimableReward: Number(rewardsData[4][i]) / Math.pow(10, feed.priceDecimal),
        ruleIds: Array.isArray(rewardsData[3][i]) ? (rewardsData[3][i] as any) : [rewardsData[3][i]]
      })
    }
  }
  if (rewardsList.length === 0) {
    return []
  }

  const agg = new Map<
    string,
    { assetId: number; rewardType: number; coinType: string; total: number }
  >()

  rewardsList.forEach((reward) => {
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

  return Array.from(groupMap.values()).map((group) => ({
    assetId: group.assetId,
    rewardType: group.rewardType,
    rewards: Array.from(group.rewards.entries()).map(([coinType, available]) => ({
      coinType,
      available: available.toFixed(6)
    }))
  }))
}

export const getUserTotalClaimedReward = withSingleton(
  async (
    address: string
  ): Promise<{
    USDValue: number
  }> => {
    const url = `https://open-api.naviprotocol.io/api/navi/user/total_claimed_reward?userAddress=${address}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  }
)

export const getUserTransactions = withSingleton(
  async (
    address: string,
    options?: {
      cursor?: string
    }
  ): Promise<{
    data: Transaction[]
    cursor?: string
  }> => {
    const params = new URLSearchParams()
    if (options?.cursor) {
      params.set('cursor', options.cursor)
    }
    params.set('userAddress', address)
    const url = `https://open-api.naviprotocol.io/api/navi/user/transactions?${params.toString()}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  }
)

export const getUserClaimedRewardHistory = withSingleton(
  async (
    address: string,
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
