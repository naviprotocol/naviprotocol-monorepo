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
import { U64_MAX } from '../../config'
import { getVaultReceipts, receiptType, planReceiptWithdrawByAmount } from './receipt'
import { VaultReward } from './reward'
import { vaultErrors } from '../../error'
import { normalizeSuiAddress } from '@mysten/sui/utils'

// ------ navi_vault ------
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

export async function withdrawPTB(
    tx: Transaction,
    vault: Vault,
    owner: string,
    target: NaviWithdrawTarget,
    options?: {
        client?: SuiGrpcClient
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

    const coins: TransactionResult[] = []
    for (const plan of plans) {
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
                tx.pure.u64(0),
                tx.pure.bool(true),
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
