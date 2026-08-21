import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { getConfig, getPriceFeeds, updateOraclePricesPTB } from '@naviprotocol/lending'
import type { NaviSuiClient } from '@naviprotocol/lending'
import { parseBaseUnits } from '../../amount'
import { VaultSdkError, operationNotSupported } from '../../errors'
import type { VaultModuleContext } from '../../module-context'
import type { IntegerString } from '../../types'
import type { NAVILendingContractConfig, NAVILendingVault } from '../../vaults'
import type { DepositPTBOptions, VaultReward, WithdrawPTBOptions, WithdrawTarget } from '../../user'
import type { ProtocolPTB } from '../types'
import { listReceipts, prepareExactCoin } from '../shared/chain'
import {
  CLOCK_OBJECT_ID,
  ORIGINAL_PACKAGE_ID,
  SUI_SYSTEM_STATE_OBJECT_ID
} from '../shared/constants'
import { planWithdrawal, readReceiptBalances, U64_MAX as MAX_AMOUNT } from './allocate'
import { defaultMarket, marketCodes, resolveMarkets } from './markets'
import type { ResolvedMarket } from './markets'

const MODULE = 'navi_vault'

/**
 * `max_shares` is left at 0 deliberately.
 *
 * The contract reads 0 as "no limit", not "no shares" — the check is skipped entirely.
 * Callers needing a bound compose `navi_vault::withdraw` themselves through this
 * protocol layer; `sdk.user` covers the common path, which matches how the NAVI vault
 * backend calls the contract today.
 */
const NO_SHARE_LIMIT = 0n

function target(config: NAVILendingContractConfig, fn: string) {
  return `${config.package}::${MODULE}::${fn}` as `${string}::${string}::${string}`
}

function normalizeCoinType(coinType: string): string {
  const [address, ...rest] = coinType.split('::')
  const hex = (address ?? '').startsWith('0x') ? (address ?? '').slice(2) : (address ?? '')
  return [`0x${hex.toLowerCase().padStart(64, '0')}`, ...rest].join('::')
}

function receiptRef(vault: NAVILendingVault) {
  return {
    originalPackageId: ORIGINAL_PACKAGE_ID[vault.protocol],
    module: MODULE,
    vaultId: vault.id
  }
}

/** A reward rule with everything `collect_reward` needs resolved. */
type HarvestableRule = {
  ruleIndex: number
  rewardCoinType: string
  storageObjectId: string
  incentiveV3ObjectId: string
  rewardFundObjectId: string
}

/**
 * Rules that must be harvested in the same transaction as a deposit or withdrawal.
 *
 * Active market rules only: vault-native rules are settled internally by the contract and
 * are exempt. A missing harvest aborts `E_REWARDS_NOT_COLLECTED`, so an unresolvable rule
 * is fatal rather than skippable.
 *
 * `Storage` and `incentive_v3` are taken from the market the rule names rather than from
 * the rule itself: `collect_reward` calls
 * `assert_storage_and_incentive_v3_match_market(navi_pool_id, ...)`, so the two can only
 * ever be that market's. Configuring them a second time on the rule would add nothing but
 * a way for the copies to disagree.
 */
function harvestableRules(vault: NAVILendingVault, markets: ResolvedMarket[]): HarvestableRule[] {
  return vault.contractConfig.naviLending.rewardRules
    .filter((rule) => rule.active && rule.type === 'market')
    .map((rule) => {
      const market = markets.find((candidate) => candidate.poolObjectId === rule.naviPoolId)
      if (!market) {
        throw new VaultSdkError(
          'VAULT_CONFIG_INVALID',
          `Reward rule ${rule.ruleIndex} on vault ${vault.id} harvests from pool ` +
            `${rule.naviPoolId}, which is none of the configured markets ` +
            `(${marketCodes(markets)}). The contract resolves the rule's Storage and ` +
            `incentive_v3 from that market, so the harvest cannot be built.`
        )
      }
      const rewardFundObjectId = market.rewardFunds[rule.rewardCoinType]
      if (!rewardFundObjectId) {
        throw new VaultSdkError(
          'VAULT_CONFIG_INVALID',
          `Market "${market.code}" publishes no RewardFund for ${rule.rewardCoinType}, which ` +
            `reward rule ${rule.ruleIndex} on vault ${vault.id} harvests. Without it every ` +
            `deposit and withdrawal on this vault aborts.`
        )
      }
      return {
        ruleIndex: rule.ruleIndex,
        rewardCoinType: rule.rewardCoinType,
        storageObjectId: market.storageObjectId,
        incentiveV3ObjectId: market.incentiveV3ObjectId,
        rewardFundObjectId
      }
    })
}

/** One `sync_market_balance` per registered market, Disabled ones included. */
function appendMarketSync(
  tx: Transaction,
  vault: NAVILendingVault,
  markets: ResolvedMarket[]
): void {
  const config = vault.contractConfig
  for (const market of markets) {
    tx.moveCall({
      target: target(config, 'sync_market_balance'),
      typeArguments: [vault.assets.base.coinType],
      arguments: [
        tx.object(vault.id),
        tx.object(market.storageObjectId),
        tx.object(market.poolObjectId),
        tx.object(CLOCK_OBJECT_ID)
      ]
    })
  }
}

/** One `collect_reward` per active market reward rule. */
function appendRewardHarvest(
  tx: Transaction,
  vault: NAVILendingVault,
  rules: HarvestableRule[]
): void {
  const config = vault.contractConfig
  for (const rule of rules) {
    tx.moveCall({
      target: target(config, 'collect_reward'),
      typeArguments: [vault.assets.base.coinType, rule.rewardCoinType],
      arguments: [
        tx.object(vault.id),
        tx.object(CLOCK_OBJECT_ID),
        tx.object(rule.storageObjectId),
        tx.object(rule.incentiveV3ObjectId),
        tx.object(rule.rewardFundObjectId),
        tx.pure.u64(rule.ruleIndex)
      ]
    })
  }
}

/**
 * The prologue `deposit` and `withdraw` both require.
 *
 * The contract asserts that every registered market was synchronized and every active
 * market rule harvested at the current `clock.timestamp_ms()` — equivalently, in this
 * transaction. That makes one deposit `M + R + 1` Move calls, and omitting any of them
 * aborts `E_MARKET_NOT_READ` (10006) or `E_REWARDS_NOT_COLLECTED` (10007).
 */
function appendFreshnessPrologue(
  tx: Transaction,
  vault: NAVILendingVault,
  markets: ResolvedMarket[]
): void {
  appendMarketSync(tx, vault, markets)
  appendRewardHarvest(tx, vault, harvestableRules(vault, markets))
}

async function resolveDepositReceipt(
  context: VaultModuleContext,
  tx: Transaction,
  vault: NAVILendingVault,
  owner: string,
  options?: DepositPTBOptions
): Promise<TransactionObjectArgument | undefined> {
  if (options?.receipt !== undefined) {
    return typeof options.receipt === 'string' ? tx.object(options.receipt) : options.receipt
  }

  // No receipt given: top up the owner's position when they hold one, mint a new one when
  // they hold none. Without this every deposit opens a fresh position and abandons the
  // previous one.
  const receipts = await listReceipts(context.client, receiptRef(vault), owner)
  if (receipts.length === 0) return undefined
  if (receipts.length === 1) return tx.object(receipts[0]!)

  // Several positions: credit the one holding the most, matching the NAVI vault backend's
  // fallback (`naviUserReceipt` ordered by shares). Its first choice — the receipt most
  // recently deposited into — needs deposit history the SDK cannot read.
  //
  // Ordering by balance also skips the empty receipts an earlier full exit leaves behind,
  // which a positional pick would happily land on.
  const balances = await readReceiptBalances(context.client, vault, receipts, owner)
  const best = balances.reduce((a, b) => (b.balance > a.balance ? b : a))
  return tx.object(best.balance > 0n ? best.receiptId : receipts[0]!)
}

/**
 * Resolves a withdrawal target to the amount the contract takes.
 *
 * `navi_vault::withdraw` is denominated in assets, not shares, so a share-denominated
 * target cannot be honoured exactly — the contract burns whatever the resulting amount
 * costs at execution time. Callers wanting exact share semantics compose the contract
 * call directly.
 */
function resolveWithdrawAmount(vault: NAVILendingVault, target_: WithdrawTarget): bigint {
  switch (target_.kind) {
    case 'all':
      // from_default clamps this to the holder's maximum redeemable value.
      return MAX_AMOUNT
    case 'amount':
      return parseBaseUnits(target_.amount)
    case 'shares':
      throw new VaultSdkError(
        'OPERATION_NOT_SUPPORTED',
        `navi_vault::withdraw takes an asset amount, not shares, so a share-denominated ` +
          `target cannot be honoured exactly. Use { kind: 'amount' } or { kind: 'all' }.`
      )
  }
}

export function createNaviLendingPTB(context: VaultModuleContext): ProtocolPTB<NAVILendingVault> {
  return {
    /**
     * `M + R + 1` Move calls: every market synchronized, every active market rule
     * harvested, then `deposit`. No oracle update — `logic::execute_deposit` takes no
     * oracle and reads no price.
     *
     * Returns `(Receipt, shares)`. The Receipt must be consumed by the transaction; the
     * caller transfers it.
     */
    async depositPTB(
      tx: Transaction,
      vault: NAVILendingVault,
      owner: string,
      amount: IntegerString,
      options?: DepositPTBOptions
    ): Promise<TransactionResult> {
      const config = vault.contractConfig
      const markets = await resolveMarkets(vault, toLendingOptions(context))
      const market = defaultMarket(vault, markets)
      const baseUnits = parseBaseUnits(amount)
      if (baseUnits <= 0n) {
        throw new VaultSdkError('INVALID_AMOUNT', 'Deposit amount must be greater than zero.')
      }

      appendFreshnessPrologue(tx, vault, markets)

      const receipt = await resolveDepositReceipt(context, tx, vault, owner, options)
      const receiptType = `${ORIGINAL_PACKAGE_ID[vault.protocol]}::${MODULE}::Receipt`
      const receiptOption = receipt
        ? tx.moveCall({
            target: '0x1::option::some',
            typeArguments: [receiptType],
            arguments: [receipt]
          })
        : tx.moveCall({ target: '0x1::option::none', typeArguments: [receiptType] })

      const coin =
        options?.coin ??
        (await prepareExactCoin(tx, context.client, {
          owner,
          coinType: vault.assets.base.coinType,
          amount: baseUnits,
          useGasCoin: options?.useGasCoin
        }))

      return tx.moveCall({
        target: target(config, 'deposit'),
        typeArguments: [vault.assets.base.coinType],
        arguments: [
          tx.object(vault.id),
          receiptOption,
          tx.object(CLOCK_OBJECT_ID),
          tx.object(market.storageObjectId),
          tx.object(market.poolObjectId),
          coin,
          tx.pure.u64(baseUnits),
          tx.object(market.incentiveV2ObjectId),
          tx.object(market.incentiveV3ObjectId)
        ]
      })
    },

    /**
     * The oracle price update must come first.
     *
     * `withdraw` reaches NAVI's collateral valuation, which asserts price validity even
     * for a debt-free vault, and it takes `PriceOracle` by immutable reference so it
     * cannot refresh the price itself. Without the update the call aborts 1502.
     *
     * Returns `(Coin, shares)`; the caller transfers the coin. Always draws from the
     * default market, which is the only penalty-free source.
     */
    async withdrawPTB(
      tx: Transaction,
      vault: NAVILendingVault,
      owner: string,
      target_: WithdrawTarget,
      options?: WithdrawPTBOptions
    ): Promise<TransactionResult> {
      const config = vault.contractConfig
      const markets = await resolveMarkets(vault, toLendingOptions(context))
      const market = defaultMarket(vault, markets)
      const amount = resolveWithdrawAmount(vault, target_)

      // One plan, possibly spanning several receipts. Each is an independent position, so
      // a request larger than any single one has to draw on more than one — the same
      // allocation the NAVI vault backend performs.
      const plan = options?.receipt
        ? [{ receiptId: options.receipt, amount }]
        : planWithdrawal(
            await readReceiptBalances(
              context.client,
              vault,
              await listReceipts(context.client, receiptRef(vault), owner),
              owner
            ),
            amount
          )

      // Prologue once for the whole block, not once per receipt.
      await appendOraclePrologue(context, tx, vault)
      appendFreshnessPrologue(tx, vault, markets)

      // `PriceOracle` is a lending-wide object, identical across markets, and already
      // published by the config service this builder reads the oracle entrypoint from.
      // Taking it from there rather than from vault configuration keeps one source.
      const { priceOracle } = await getConfig(toLendingOptions(context))

      const coins: TransactionObjectArgument[] = []
      for (const step of plan) {
        const [coin] = tx.moveCall({
          target: target(config, 'withdraw'),
          typeArguments: [vault.assets.base.coinType],
          arguments: [
            tx.object(vault.id),
            typeof step.receiptId === 'string' ? tx.object(step.receiptId) : step.receiptId,
            tx.object(CLOCK_OBJECT_ID),
            tx.object(priceOracle),
            tx.object(market.storageObjectId),
            tx.object(market.poolObjectId),
            tx.pure.u64(step.amount),
            tx.pure.u64(NO_SHARE_LIMIT),
            tx.pure.bool(true),
            tx.object(market.incentiveV2ObjectId),
            tx.object(market.incentiveV3ObjectId),
            tx.object(SUI_SYSTEM_STATE_OBJECT_ID)
          ]
        })
        coins.push(coin as TransactionObjectArgument)
      }

      // Hand back a single coin. Merging here rather than leaving N live objects matches
      // the backend and keeps the caller's job to one transfer.
      const [first, ...rest] = coins
      if (rest.length > 0) tx.mergeCoins(first!, rest)
      return first as unknown as TransactionResult
    },

    async cancelDepositPTB(
      tx: Transaction,
      vault: NAVILendingVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void requestId
      void receipt
      return operationNotSupported('protocols.navi-lending.cancelDepositPTB')
    },

    async cancelWithdrawPTB(
      tx: Transaction,
      vault: NAVILendingVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void requestId
      void receipt
      return operationNotSupported('protocols.navi-lending.cancelWithdrawPTB')
    },

    /**
     * Harvests the rules paying each requested coin, then claims per receipt.
     *
     * `claim_reward` is generic over the reward coin, so one call settles every rule
     * paying that coin for one receipt. It returns a zero-valued coin rather than
     * aborting when nothing is claimable, and that object still has to be consumed —
     * which is why the caller filters `getRewards` output first.
     */
    async claimRewardsPTB(
      tx: Transaction,
      vault: NAVILendingVault,
      owner: string,
      rewards: VaultReward[]
    ): Promise<TransactionResult> {
      void owner
      if (rewards.length === 0) {
        throw new VaultSdkError('INVALID_AMOUNT', 'No rewards selected to claim.')
      }

      const config = vault.contractConfig
      const wanted = new Set(rewards.map((reward) => normalizeCoinType(reward.rewardCoinType)))
      const markets = await resolveMarkets(vault, toLendingOptions(context))
      const matching = harvestableRules(vault, markets).filter((rule) =>
        wanted.has(normalizeCoinType(rule.rewardCoinType))
      )
      appendRewardHarvest(tx, vault, matching)

      // Group by reward coin type and merge each group. Every claim returns a live Coin,
      // so returning only the last would leave the others unconsumed and the transaction
      // invalid. Mirrors the backend, which merges same-type outputs per vault.
      const byCoinType = new Map<string, TransactionObjectArgument[]>()
      for (const reward of rewards) {
        const coin = tx.moveCall({
          target: target(config, 'claim_reward'),
          typeArguments: [vault.assets.base.coinType, reward.rewardCoinType],
          arguments: [tx.object(vault.id), tx.object(reward.receiptId), tx.object(CLOCK_OBJECT_ID)]
        })
        const key = normalizeCoinType(reward.rewardCoinType)
        const group = byCoinType.get(key)
        if (group) group.push(coin as TransactionObjectArgument)
        else byCoinType.set(key, [coin as TransactionObjectArgument])
      }

      let survivor: TransactionObjectArgument | undefined
      for (const coins of byCoinType.values()) {
        const [first, ...rest] = coins
        if (rest.length > 0) tx.mergeCoins(first!, rest)
        survivor = first
      }

      // One coin type survives as the return value; the others are merged and still live
      // for the caller to consume. Claiming several reward types therefore means reading
      // the block's results rather than relying on this single handle.
      return survivor as unknown as TransactionResult
    }
  }
}

/**
 * Refreshes the oracle price for the vault's asset.
 *
 * A price is valid only while `now - price.timestamp <= PriceOracle.update_interval`,
 * 30 seconds by default, and `withdraw` takes `PriceOracle` immutably so it cannot
 * refresh it. Omitting this aborts 1502.
 *
 * Delegated to `@naviprotocol/lending`, which resolves the entrypoint name and every
 * oracle object from NAVI's configuration service. The entrypoint is versioned and
 * successive revisions accept different Pyth `PriceInfoObject` types, so resolving it at
 * runtime means an oracle upgrade needs no SDK release.
 */
async function appendOraclePrologue(
  context: VaultModuleContext,
  tx: Transaction,
  vault: NAVILendingVault
): Promise<void> {
  const lendingOptions = toLendingOptions(context)
  const feeds = await getPriceFeeds(lendingOptions)
  const wanted = normalizeCoinType(vault.assets.base.coinType)
  const matching = feeds.filter((feed) => normalizeCoinType(feed.coinType) === wanted)

  if (matching.length === 0) {
    throw new VaultSdkError(
      'VAULT_CONFIG_INVALID',
      `No oracle price feed is configured for ${vault.assets.base.coinType}. Withdrawals ` +
        `from vault ${vault.id} abort 1502 without one.`
    )
  }

  await updateOraclePricesPTB(tx, matching, { ...lendingOptions, updatePythPriceFeeds: true })
}

/**
 * Narrows SDK state to the options `@naviprotocol/lending` accepts.
 *
 * Not tidiness: lending derives its cache keys with `JSON.stringify` over the argument
 * list, and `JSON.stringify` throws on a BigInt. Forwarding anything carrying one fails
 * inside lending, far from the call site.
 */
function toLendingOptions(context: VaultModuleContext) {
  return {
    // Structurally compatible — both sides only require a `core` property. Casting here
    // keeps the Sui SDK's client subpath out of this package's published declarations,
    // which the repo's SDK v2 boundary check rejects.
    client: context.client as NaviSuiClient,
    // One SDK instance serves one environment: `test` is a separate stage deployment with
    // its own API, not a mix of vaults inside one instance.
    env: (context.env === 'test' ? 'dev' : 'prod') as 'dev' | 'prod'
  }
}
