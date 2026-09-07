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
import { apportion, parseTxValue } from '../../utils'
import { U64_MAX } from '../../config'
import { getVaultReceipts, receiptType, planReceiptWithdrawByAmount } from './receipt'
import { VaultReward } from './reward'
import { vaultErrors } from '../../error'
import { normalizeSuiAddress } from '@mysten/sui/utils'

// ------ navi_vault ------
/**
 * `navi_vault::withdraw`'s `from_default_market` flag. Drawing from a non-default market
 * charges a penalty, so this SDK always takes the default one.
 */
const FROM_DEFAULT_MARKET = true

/**
 * Syncs the vault's cached balance in every registered lending market with the market's
 * actual on-chain balance.
 *
 * Appends one `sync_market_balance` call per market in `Vault.markets`. Required before
 * deposit/withdraw so shares are priced against up-to-date `total_assets` —
 * {@link depositPTB} and {@link withdrawPTB} already do this for you.
 *
 * @param tx - Transaction to append the sync calls to
 * @param vault - The NAVI vault to sync. Must carry `vault.navi` config
 * @param options - Optional client override
 * @param options.client - gRPC client used to read the vault object. Defaults to a mainnet client
 * @returns Promise<void> - Calls are appended to `tx`; nothing is returned
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault
 */
export async function syncMarketBalancePTB(
  tx: Transaction,
  vault: Vault,
  options?: {
    client?: SuiGrpcClient
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

/**
 * Harvests the vault's market reward rules from the underlying NAVI lending markets,
 * advancing each rule's on-chain reward index.
 *
 * Appends one `collect_reward` call per rule that is both active and non-vault-native;
 * vault-native rules are funded by admin deposits and need no harvesting. Until this runs,
 * rewards sitting unharvested in the underlying market are invisible to reward reads.
 * {@link depositPTB}, {@link withdrawPTB}, and {@link claimRewardsPTB} already do this for you.
 *
 * @param tx - Transaction to append the harvest calls to
 * @param vault - The NAVI vault to harvest. Must carry `vault.navi` config
 * @param options - Optional client override
 * @param options.client - gRPC client used to read the vault object. Defaults to a mainnet client
 * @returns Promise<void> - Calls are appended to `tx`; nothing is returned
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault, or
 *         `VAULT_CONFIG_INVALID` when a rule's lending pool or its market's reward fund
 *         cannot be resolved
 */
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
    // TODO(multi-market): getPools above only searches the main lending market;
    // supporting reward rules from other markets needs an explicit markets option.
    const pool = pools.find((p) => {
      return reward.naviPoolId === normalizeSuiAddress(p.contract.pool)
    })
    if (!pool) {
      throw vaultErrors.vaultConfigInvalid(
        vault.id,
        `reward pool ${reward.naviPoolId} was not found`,
        { rewardPoolId: reward.naviPoolId, rewardCoinType: reward.rewardCoinType }
      )
    }
    const config = await getConfig({
      market: pool.market,
      cacheTime: DEFAULT_CACHE_TIME
    })
    const rewardFund = config.rewardFunds[reward.rewardCoinType]
    if (!rewardFund) {
      throw vaultErrors.vaultConfigInvalid(
        vault.id,
        `market ${pool.market} has no reward fund for ${reward.rewardCoinType}`,
        { market: pool.market, rewardCoinType: reward.rewardCoinType }
      )
    }
    tx.moveCall({
      target: `${vault!.navi!.package}::navi_vault::collect_reward`,
      typeArguments: [vault.assets.baseCoin.coinType, reward.rewardCoinType],
      arguments: [
        tx.object(vault.id),
        tx.object('0x6'),
        tx.object(config.storage),
        tx.object(config.incentiveV3),
        tx.object(rewardFund),
        tx.pure.u64(reward.ruleIndex)
      ]
    })
  }
}

/**
 * Builds calls to harvest and claim the given NAVI vault rewards.
 *
 * Harvests once per distinct vault (via {@link collectNaviRewardsPTB}) so indices are current,
 * then appends one `claim_reward` per entry in `rewards`. Because a claim settles before it
 * pays, each one hands out `claimable + pending` for its rule key, bounded by the vault's
 * collected balance for that coin. Payouts sharing a coin type are merged into one coin.
 *
 * The returned coins are unconsumed — the caller must transfer or otherwise use them, or the
 * transaction will fail.
 *
 * @param tx - Transaction to append the harvest and claim calls to
 * @param rewards - Reward positions to claim, from {@link getVaultRewards}. May span several
 *                  receipts and several vaults; each entry is claimed individually
 * @param options - Optional client override
 * @param options.client - gRPC client used to read vault objects. Defaults to a mainnet client
 * @returns Promise of one entry per distinct `rewardCoinType` among `rewards`, each
 *          `{ coin, coinType }` with the merged claimed coin
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when a reward's vault is not a NAVI vault,
 *         or `VAULT_CONFIG_INVALID` when a rule's pool or reward fund cannot be resolved
 */
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

/**
 * Creates a new, empty NAVI vault receipt.
 *
 * {@link depositPTB} calls this automatically when the owner holds no receipt yet, so most
 * callers never need it directly. The returned receipt is unconsumed — pass it to a deposit
 * or transfer it, or the transaction will fail.
 *
 * @param tx - Transaction to append the create call to
 * @param vault - The NAVI vault to create a receipt for. Must carry `vault.navi` config
 * @returns TransactionResult - The newly created `navi_vault::Receipt`
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault
 */
export function createReceiptPTB(tx: Transaction, vault: Vault) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.navi!.package}::navi_vault::create_receipt`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [tx.object(vault.id)]
  })
}

/**
 * Builds a deposit into a NAVI vault, in raw base units.
 *
 * Syncs market balances and harvests rewards first so the deposit is priced against
 * up-to-date state, then reuses the owner's lowest-share existing receipt if one exists
 * (otherwise creates a new one via {@link createReceiptPTB}). Deposits into the vault's
 * default lending pool and settles in the same transaction.
 *
 * The top-level `depositPTB` wraps this with human-unit amount parsing and source dispatch.
 *
 * @param tx - Transaction to append the deposit calls to
 * @param vault - The NAVI vault to deposit into. Must carry `vault.navi` config
 * @param owner - Sui address whose receipts are searched for one to reuse
 * @param amount - Deposit amount in RAW base units. Must be a `bigint` unless `options.coin`
 *                 is given, in which case a transaction argument is also accepted
 * @param options - Optional coin source and client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @param options.coin - Coin object to deposit from. When omitted, one is split from the owner's
 *                       balance (or gas coin, with `useGasCoin`) for `amount`
 * @param options.useGasCoin - Split the deposit coin from the transaction's gas coin instead of
 *                             a coin object lookup. Ignored when `coin` is given
 * @returns Promise<TransactionResult> - The `navi_vault::deposit` result, `[Receipt, shares]`.
 *          The `Receipt` is unconsumed — transfer it to the owner, or the transaction will fail
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault,
 *         `INVALID_AMOUNT` when `amount` is not a `bigint` and no `coin` was supplied, or
 *         `VAULT_CONFIG_INVALID` when the vault's default pool or its market cannot be resolved
 */
export async function depositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  amount: bigint | TransactionArgument | TransactionResult,
  options?: {
    client?: SuiGrpcClient
    coin?: TransactionObjectArgument
    useGasCoin?: boolean
  }
): Promise<TransactionResult> {
  checkVault(vault)
  await syncMarketBalancePTB(tx, vault, { client: options?.client })
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

/**
 * Withdraw target in the units the NAVI vault contract works with.
 *
 * `navi_vault::withdraw` takes an ASSET amount (base units), not shares — the
 * mainnet contract pays out exactly the passed amount and burns
 * `amount * total_shares / total_assets` shares. A `shares` target is therefore
 * converted to an asset amount with the on-chain exchange rate before planning.
 */
export type NaviWithdrawTarget =
  | { kind: 'amount'; amount: bigint }
  | { kind: 'shares'; shares: bigint }
  | { kind: 'all' }

/**
 * Builds a withdrawal from a NAVI vault, in raw base units.
 *
 * Plans which receipt(s) to draw from (via {@link planReceiptWithdrawByAmount}), updates
 * oracle prices, syncs market balances, and harvests rewards, then issues one
 * `navi_vault::withdraw` call per receipt in the plan, merging the resulting coins into one.
 *
 * A `shares` target is converted to an asset amount at the vault's current on-chain exchange
 * rate before planning, because the contract withdraws by asset amount — see
 * {@link NaviWithdrawTarget}.
 *
 * The top-level `withdrawPTB` wraps this with human-unit amount parsing and source dispatch.
 *
 * @param tx - Transaction to append the withdrawal calls to
 * @param vault - The NAVI vault to withdraw from. Must carry `vault.navi` config
 * @param owner - Sui address whose receipts are drawn from
 * @param target - What to withdraw, in raw base units or raw shares; see {@link NaviWithdrawTarget}
 * @param options - Optional client override and payout floor
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @param options.minAmountOut - Minimum base-coin amount the withdrawal must pay out, enforced
 *        on-chain per call. A withdrawal spread over several receipts divides the floor
 *        between them in proportion to each receipt's redeemable value
 * @returns Promise<TransactionResult> - The withdrawn coin, merged across every receipt drawn
 *          from. Unconsumed: the caller must transfer or otherwise use it
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault,
 *         `INSUFFICIENT_BALANCE` when the owner's receipts cannot cover the request (or the
 *         vault has no shares to price a `shares` target against), `INVALID_AMOUNT` when the
 *         resolved amount is not positive, or `VAULT_CONFIG_INVALID` when the vault's market
 *         cannot be resolved
 */
export async function withdrawPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  target: NaviWithdrawTarget,
  options?: {
    client?: SuiGrpcClient
    minAmountOut?: bigint
  }
) {
  checkVault(vault)
  const receipts = await getVaultReceipts(vault, owner, options)
  const vaultInfo = await getVaultInfo(vault, {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const totalAssets = BigInt(vaultInfo.total_assets)
  const totalShares = BigInt(vaultInfo.total_shares)

  let amount: bigint
  if (target.kind === 'all') {
    amount = U64_MAX
  } else if (target.kind === 'amount') {
    amount = target.amount
  } else {
    if (totalShares === 0n) {
      throw vaultErrors.insufficientBalance('Vault has no shares to withdraw from', {
        vaultId: vault.id,
        owner
      })
    }
    // Shares -> assets at the current on-chain rate, floored like the contract does.
    amount = (target.shares * totalAssets) / totalShares
  }
  if (amount <= 0n) {
    throw vaultErrors.invalidAmount('withdraw amount must be greater than zero', {
      target: { ...target } as Record<string, unknown>
    })
  }

  const { plans, shortfall } = planReceiptWithdrawByAmount(
    receipts,
    amount,
    totalAssets,
    totalShares
  )
  if (plans.length === 0 || shortfall > 0n) {
    throw vaultErrors.insufficientBalance('Vault receipts cannot cover the requested withdrawal', {
      vaultId: vault.id,
      owner,
      requestedAmount: amount === U64_MAX ? 'all' : amount.toString(),
      uncoveredAmount: shortfall.toString()
    })
  }

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

  await syncMarketBalancePTB(tx, vault, { client: options?.client })
  await collectNaviRewardsPTB(tx, vault, {
    client: options?.client
  })

  // A plan carrying the U64_MAX sentinel drains its receipt, so its payout is the
  // receipt's redeemable value rather than the literal argument.
  const shareOf = new Map(receipts.map((receipt) => [receipt.id, receipt.shares]))
  const floors = apportion(
    options?.minAmountOut ?? 0n,
    plans.map((plan) => {
      if (plan.amount !== U64_MAX) return plan.amount
      if (totalShares === 0n) return 1n
      return ((shareOf.get(plan.id) ?? 0n) * totalAssets) / totalShares
    })
  )

  const coins: TransactionResult[] = []
  for (const [index, plan] of plans.entries()) {
    const [coin] = tx.moveCall({
      target: `${vault!.navi!.package}::navi_vault::withdraw`,
      typeArguments: [vault.assets.baseCoin.coinType],
      arguments: [
        tx.object(vault.id),
        tx.object(plan.id),
        tx.object('0x6'),
        tx.object(marketConfig.priceOracle),
        tx.object(marketConfig.storage),
        tx.object(pool.contract.pool),
        tx.pure.u64(plan.amount),
        tx.pure.u64(floors[index]),
        tx.pure.bool(FROM_DEFAULT_MARKET),
        tx.object(marketConfig.incentiveV2),
        tx.object(marketConfig.incentiveV3),
        tx.object('0x5')
      ]
    })
    coins.push(coin as any)
  }

  if (coins.length > 1) {
    tx.mergeCoins(coins[0], coins.slice(1))
  }

  return coins[0]
}
