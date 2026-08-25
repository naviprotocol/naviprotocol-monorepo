import {
  Transaction,
  TransactionResult,
  TransactionObjectArgument,
  TransactionArgument
} from '@mysten/sui/transactions'
import { Vault } from '../../types'
import {
  getPools,
  DEFAULT_CACHE_TIME,
  getConfig,
  updateOraclePricesPTB,
  getPriceFeeds,
  filterPriceFeeds
} from '@naviprotocol/lending'
import { getMarketConfig, checkVault } from './utils'
import { getVaultDefaultPool, getVaultInfo, getVaultRewardRules } from './vault'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseTxValue } from '../../utils'
import { getVaultReceipts, receiptType, planReceiptWithdraw } from './receipt'
import { VaultReward } from './reward'
import { vaultErrors } from '../../error'

// ------ navi_vault ------
export async function syncMarketBalancePTB(
  tx: Transaction,
  vault: Vault,
  options?: {
    client: SuiGrpcClient
  }
) {
  checkVault(vault)

  const vaultInfo = await getVaultInfo(vault, {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  for (let market of vaultInfo.markets.contents) {
    tx.moveCall({
      target: `${vault!.navi!.package}::navi_vault::sync_market_balance`,
      typeArguments: [vault.assets.baseCoin.coinType],
      arguments: [
        tx.object(vault.id),
        tx.object(market.value.storage_address),
        tx.object(market.key),
        tx.object('0x6')
      ]
    })
  }
}

export async function collectNaviRewardsPTB(
  tx: Transaction,
  vault: Vault,
  options?: {
    client?: SuiGrpcClient
  }
) {
  checkVault(vault)
  const rewards = await getVaultRewardRules(vault, options)
  const activeRewards = rewards.filter((reward) => {
    return reward.isActive && !reward.isVaultNative
  })
  const poolList = activeRewards.map((reward) => {
    return reward.naviPoolId
  })
  const pools = await getPools({
    pools: poolList,
    cacheTime: DEFAULT_CACHE_TIME
  })

  for (let reward of activeRewards) {
    const pool = pools.find((p) => {
      return reward.naviPoolId === p.contract.pool
    })
    const config = await getConfig({
      market: pool?.market,
      cacheTime: DEFAULT_CACHE_TIME
    })
    tx.moveCall({
      target: `${vault!.navi!.package}::navi_vault::collect_reward`,
      typeArguments: [vault.assets.baseCoin.coinType, reward.rewardCoinType],
      arguments: [
        tx.object(vault.id),
        tx.object('0x6'),
        tx.object(config.storage),
        tx.object(config.incentiveV3),
        tx.object(config.rewardFunds[reward.rewardCoinType]),
        tx.pure.u64(reward.ruleIndex)
      ]
    })
  }
}

export async function claimRewardsPTB(
  tx: Transaction,
  rewards: VaultReward[],
  options?: {
    client: SuiGrpcClient
  }
) {
  const rewardCoins = {} as Record<string, TransactionResult[]>
  const vaultMap = {} as Record<string, Vault>
  rewards.forEach((reward) => {
    vaultMap[reward.vault.id] = reward.vault
  })
  const vaults = Object.values(vaultMap)
  for (let vault of vaults) {
    await collectNaviRewardsPTB(tx, vault, options)
  }

  rewards.forEach((reward) => {
    const coin = tx.moveCall({
      target: `${reward.vault!.navi!.package}::navi_vault::claim_reward`,
      typeArguments: [reward.vault.assets.baseCoin.coinType, reward.rewardCoinType],
      arguments: [tx.object(reward.vault.id), tx.object(reward.receipt), tx.object('0x6')]
    })
    if (!rewardCoins[reward.rewardCoinType]) {
      rewardCoins[reward.rewardCoinType] = []
    }
    rewardCoins[reward.rewardCoinType].push(coin)
  })

  return Object.entries(rewardCoins).map(([coinType, coins]) => {
    if (coins.length > 1) {
      tx.mergeCoins(coins[0], coins.slice(1))
    }
    return {
      coin: coins[0],
      coinType
    }
  })
}

export function createReceiptPTB(tx: Transaction, vault: Vault) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.navi!.package}::navi_vault::create_receipt`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [tx.object(vault.id)]
  })
}

export async function depositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  amount: bigint | TransactionArgument | TransactionResult,
  options?: {
    client?: SuiGrpcClient
    coin?: TransactionObjectArgument
    useGasCoin?: boolean
    expectedShares?: number
  }
): Promise<TransactionResult> {
  checkVault(vault)
  await syncMarketBalancePTB(tx, vault)
  await collectNaviRewardsPTB(tx, vault, {
    client: options?.client
  })
  const receipts = await getVaultReceipts(vault, owner, {
    client: options?.client
  })
  receipts.sort((a, b) => {
    return Number(a.shares - b.shares)
  })
  const receipt = receipts[0] ? receipts[0].id : createReceiptPTB(tx, vault)

  let coin = options?.coin
  if (!coin) {
    if (typeof amount === 'bigint') {
      coin = tx.coin({
        balance: amount,
        type: vault.assets.baseCoin.coinType,
        useGasCoin: options?.useGasCoin
      })
    } else {
      throw vaultErrors.invalidAmount('amount must be bigint when coin is not provided', {
        receivedType: typeof amount
      })
    }
  }
  const pool = await getVaultDefaultPool(vault, {
    client: options?.client
  })
  if (!pool) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'default pool was not found')
  }
  const marketConfig = await getMarketConfig(pool.market)
  if (!marketConfig) {
    throw vaultErrors.vaultConfigInvalid(vault.id, `market ${pool.market} was not found`, {
      market: pool.market
    })
  }

  const receiptOption = receipt
    ? tx.moveCall({
        target: '0x1::option::some',
        typeArguments: [receiptType],
        arguments: [parseTxValue(receipt, tx.object)]
      })
    : tx.moveCall({ target: '0x1::option::none', typeArguments: [receiptType] })

  return tx.moveCall({
    target: `${vault!.navi!.package}::navi_vault::deposit`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(vault.id),
      receiptOption,
      tx.object('0x6'),
      tx.object(marketConfig.storage),
      tx.object(pool.contract.pool),
      parseTxValue(coin, tx.object),
      parseTxValue(amount, tx.pure.u64),
      tx.object(marketConfig.incentiveV2),
      tx.object(marketConfig.incentiveV3)
    ]
  })
}

export async function withdrawPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  shares: bigint,
  options?: {
    client?: SuiGrpcClient
  }
) {
  checkVault(vault)
  const receipts = await getVaultReceipts(vault, owner, options)
  const withdrawReceipts = planReceiptWithdraw(receipts, shares)
  const pool = await getVaultDefaultPool(vault, options)
  const marketConfig = await getMarketConfig(pool.market)

  if (!marketConfig) {
    throw vaultErrors.vaultConfigInvalid(vault.id, `market ${pool.market} was not found`, {
      market: pool.market,
      operation: 'withdrawPTB'
    })
  }

  const priceFeeds = await getPriceFeeds({
    env: 'prod'
  })

  await updateOraclePricesPTB(
    tx,
    filterPriceFeeds(priceFeeds, {
      pools: [pool]
    }),
    {
      client: options?.client,
      env: 'prod',
      market: pool.market,
      updatePythPriceFeeds: true
    }
  )

  await syncMarketBalancePTB(tx, vault)
  await collectNaviRewardsPTB(tx, vault, {
    client: options?.client
  })

  const coins: TransactionResult[] = []
  for (let i = 0; i < withdrawReceipts.length; i++) {
    const receipt = withdrawReceipts[i]
    if (receipt.shares > 0) {
      const [coin] = tx.moveCall({
        target: `${vault!.navi!.package}::navi_vault::withdraw`,
        typeArguments: [vault.assets.baseCoin.coinType],
        arguments: [
          tx.object(vault.id),
          tx.object(receipt.id),
          tx.object('0x6'),
          tx.object(marketConfig.priceOracle),
          tx.object(marketConfig.storage),
          tx.object(pool.contract.pool),
          tx.pure.u64(receipt.shares),
          tx.pure.u64(0),
          tx.pure.bool(true),
          tx.object(marketConfig.incentiveV2),
          tx.object(marketConfig.incentiveV3),
          tx.object('0x5')
        ]
      })
      coins.push(coin as any)
    }
  }

  if (coins.length > 1) {
    tx.mergeCoins(coins[0], coins.slice(1))
  }

  if (coins.length === 0) {
    throw vaultErrors.insufficientBalance('No vault receipt has shares available to withdraw', {
      vaultId: vault.id,
      owner,
      requestedShares: shares.toString()
    })
  }

  return coins[0]
}
