import type {
  SuiClientOption,
  EnvOption,
  LendingRewardSummary,
  LendingReward,
  HistoryClaimedReward,
  LendingClaimedReward,
  TransactionResult,
  AccountCapOption
} from './types'
import { Transaction } from '@mysten/sui/transactions'
import { getConfig, DEFAULT_CACHE_TIME } from './config'
import {
  suiClient,
  camelize,
  parseDevInspectResult,
  normalizeCoinType,
  withSingleton,
  parseTxVaule
} from './utils'
import { bcs } from '@mysten/sui/bcs'
import { getPriceFeeds } from './oracle'
import { getPools, depositCoinPTB } from './pool'

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
  const tx = new Transaction()
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

export function summaryLendingRewards(rewards: LendingReward[]): LendingRewardSummary[] {
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
  for (const [rewardCoinType, { assetIds, ruleIds }] of rewardMap) {
    const pool = pools.find(
      (p) => normalizeCoinType(p.suiCoinType) === normalizeCoinType(rewardCoinType)
    )
    if (!pool || !pool.contract.rewardFundId) {
      throw new Error(`No matching rewardFund found for reward coin: ${rewardCoinType}`)
    }
    const matchedRewardFund = pool.contract.rewardFundId

    if (options?.accountCap && !options.customCoinReceive) {
      throw new Error('customCoinReceive is required when accountCap is provided')
    }
    if (options?.customCoinReceive) {
      let rewardBalance

      if (options.accountCap) {
        rewardBalance = tx.moveCall({
          target: `${config.package}::incentive_v3::claim_reward_with_account_cap`,
          arguments: [
            tx.object('0x06'),
            tx.object(config.incentiveV3),
            tx.object(config.storage),
            tx.object(matchedRewardFund),
            tx.pure.vector('string', assetIds),
            tx.pure.vector('address', ruleIds),
            parseTxVaule(options.accountCap, tx.object)
          ],
          typeArguments: [rewardCoinType]
        })
      } else {
        rewardBalance = tx.moveCall({
          target: `${config.package}::incentive_v3::claim_reward`,
          arguments: [
            tx.object('0x06'),
            tx.object(config.incentiveV3),
            tx.object(config.storage),
            tx.object(matchedRewardFund),
            tx.pure.vector('string', assetIds),
            tx.pure.vector('address', ruleIds)
          ],
          typeArguments: [rewardCoinType]
        })
      }

      const [rewardCoin]: any = tx.moveCall({
        target: '0x2::coin::from_balance',
        arguments: [rewardBalance],
        typeArguments: [rewardCoinType]
      })

      if (options?.customCoinReceive.type === 'transfer') {
        if (!options.customCoinReceive.transfer) {
          throw new Error('customCoinReceive.transfer is required')
        }
        tx.transferObjects(
          [rewardCoin],
          parseTxVaule(options.customCoinReceive.transfer, tx.pure.address)
        )
      }
      if (options?.customCoinReceive.type === 'depositNAVI') {
        await depositCoinPTB(tx, pool, rewardCoin, options)
      } else {
        rewardCoins.push({
          coin: rewardCoin,
          identifier: pool
        })
      }
    } else {
      tx.moveCall({
        target: `${config.package}::incentive_v3::claim_reward_entry`,
        arguments: [
          tx.object('0x06'),
          tx.object(config.incentiveV3),
          tx.object(config.storage),
          tx.object(matchedRewardFund),
          tx.pure.vector('string', assetIds),
          tx.pure.vector('address', ruleIds)
        ],
        typeArguments: [rewardCoinType]
      })
    }
  }
  return rewardCoins
}
