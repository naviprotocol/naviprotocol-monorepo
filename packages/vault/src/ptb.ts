/**
 * Vault PTB Builders
 *
 * Low-level, synchronous command emitters. Each appends Move calls to a transaction and
 * performs no network I/O, so the caller controls exactly what a block contains.
 *
 * Unlike a single-call protocol, a vault deposit or withdrawal is `M + R + 1` commands:
 * every registered market must be synchronized and every active market reward rule
 * harvested in the *same* transaction, because the contract asserts they were refreshed
 * at the current `clock.timestamp_ms()`. {@link appendFreshnessPTB} emits that prologue;
 * the async builders in `deposit.ts` / `withdraw.ts` wrap all of it.
 *
 * Object ids for markets come from the layout, not from configuration — the contract
 * validates them against what it has recorded and aborts `E_MARKET_CONFIG_MISMATCH`
 * (10017) on any divergence.
 *
 * @module VaultPtb
 */

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { VAULT_MODULE } from './config'
import type {
  HarvestableRule,
  MarketLayout,
  VaultConfig,
  VaultDescriptor,
  VaultLayout
} from './types'

/** Everything the PTB builders need that is not on the transaction itself. */
export type VaultTxContext = {
  /** LATEST package id — the moveCall target. */
  packageId: string
  /** ORIGINAL package id — used for the `Receipt` type argument. */
  typePackageId: string
  descriptor: VaultDescriptor
  sharedObjects: VaultConfig['sharedObjects']
}

/** Builds a {@link VaultTxContext} from a resolved config and descriptor. */
export function createTxContext(config: VaultConfig, descriptor: VaultDescriptor): VaultTxContext {
  return {
    packageId: config.package.packageId,
    typePackageId: config.package.typePackageId,
    descriptor,
    sharedObjects: config.sharedObjects
  }
}

function target(packageId: string, fn: string): `${string}::${string}::${string}` {
  return `${packageId}::${VAULT_MODULE}::${fn}`
}

function receiptType(ctx: VaultTxContext): string {
  return `${ctx.typePackageId}::${VAULT_MODULE}::Receipt`
}

/**
 * Appends one `sync_market_balance` per registered market.
 *
 * Every market must be included, Disabled ones too: they remain part of assets under
 * management and remain withdrawable, so omitting one aborts `E_MARKET_NOT_READ` (10006).
 */
export function appendSyncMarketsPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  layout: VaultLayout
): Transaction {
  for (const market of layout.markets) {
    tx.moveCall({
      target: target(ctx.packageId, 'sync_market_balance'),
      typeArguments: [ctx.descriptor.coinType],
      arguments: [
        tx.object(ctx.descriptor.vault),
        tx.object(market.storageId),
        tx.object(market.poolId),
        tx.object(ctx.sharedObjects.clock)
      ]
    })
  }
  return tx
}

/**
 * Appends one `collect_reward` per harvestable rule.
 *
 * Pass the output of `selectHarvestableRules`. Vault-native and inactive rules are
 * excluded there: the contract returns from `collect_reward` without effect for those —
 * including without updating `last_harvest_at` — so calling them is harmless but pure
 * wasted gas.
 */
export function appendCollectRewardsPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  rules: HarvestableRule[]
): Transaction {
  for (const rule of rules) {
    tx.moveCall({
      target: target(ctx.packageId, 'collect_reward'),
      typeArguments: [ctx.descriptor.coinType, rule.rewardCoinType],
      arguments: [
        tx.object(ctx.descriptor.vault),
        tx.object(ctx.sharedObjects.clock),
        tx.object(rule.storageId),
        tx.object(rule.incentiveV3Id),
        tx.object(rule.rewardFund),
        tx.pure.u64(rule.index)
      ]
    })
  }
  return tx
}

/**
 * Appends the full freshness prologue: every market synchronized, then every active
 * market rule harvested.
 *
 * Required before `deposit` and `withdraw`. Not required before `claim_reward`.
 */
export function appendFreshnessPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  layout: VaultLayout,
  rules: HarvestableRule[]
): Transaction {
  appendSyncMarketsPTB(tx, ctx, layout)
  appendCollectRewardsPTB(tx, ctx, rules)
  return tx
}

/**
 * Appends `deposit` and returns its `(Receipt, shares)` results.
 *
 * The freshness prologue must already be on the transaction. The returned receipt is a
 * hot potato — it must be consumed by the block, normally transferred to the depositor.
 *
 * @param coin - Coin argument whose value must equal `amount` exactly, otherwise the
 *   call aborts `E_AMOUNT_MISMATCH` (10021). Split it beforehand.
 * @param receipt - Existing receipt to add to, or `undefined` to mint a new one.
 */
export function depositPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  args: {
    market: MarketLayout
    coin: TransactionObjectArgument
    amount: bigint
    receipt?: TransactionObjectArgument
  }
): TransactionObjectArgument[] {
  const option = args.receipt
    ? tx.moveCall({
        target: '0x1::option::some',
        typeArguments: [receiptType(ctx)],
        arguments: [args.receipt]
      })
    : tx.moveCall({
        target: '0x1::option::none',
        typeArguments: [receiptType(ctx)]
      })

  return tx.moveCall({
    target: target(ctx.packageId, 'deposit'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [
      tx.object(ctx.descriptor.vault),
      option,
      tx.object(ctx.sharedObjects.clock),
      tx.object(args.market.storageId),
      tx.object(args.market.poolId),
      args.coin,
      tx.pure.u64(args.amount),
      tx.object(ctx.sharedObjects.incentiveV2),
      tx.object(args.market.incentiveV3Id)
    ]
  })
}

/**
 * Appends `withdraw` and returns its `(Coin, sharesBurned)` results.
 *
 * The freshness prologue must already be on the transaction, and — unlike deposit — an
 * oracle price update must precede it, because `withdraw` reaches NAVI's collateral
 * valuation and takes `PriceOracle` by immutable reference so it cannot refresh the
 * price itself. Without it the call aborts 1502.
 *
 * @param market - Source of the shortfall after the idle balance is drawn down. When
 *   idle covers the full amount this argument is not validated and no penalty applies.
 * @param maxShares - Upper bound on shares burned. `0n` skips the check entirely — it
 *   means "no limit", not "no shares".
 * @param fromDefault - When true, `market` must be the default market, no penalty
 *   applies, and `amount` is clamped to the holder's maximum redeemable value, so
 *   `MAX_U64` requests a full exit.
 */
export function withdrawPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  args: {
    market: MarketLayout
    receipt: TransactionObjectArgument
    amount: bigint
    maxShares: bigint
    fromDefault: boolean
  }
): TransactionObjectArgument[] {
  return tx.moveCall({
    target: target(ctx.packageId, 'withdraw'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [
      tx.object(ctx.descriptor.vault),
      args.receipt,
      tx.object(ctx.sharedObjects.clock),
      tx.object(ctx.sharedObjects.priceOracle),
      tx.object(args.market.storageId),
      tx.object(args.market.poolId),
      tx.pure.u64(args.amount),
      tx.pure.u64(args.maxShares),
      tx.pure.bool(args.fromDefault),
      tx.object(ctx.sharedObjects.incentiveV2),
      tx.object(args.market.incentiveV3Id),
      tx.object(ctx.sharedObjects.suiSystemState)
    ]
  })
}

/**
 * Appends `claim_reward` and returns the reward coin.
 *
 * One call settles every rule paying `rewardCoinType`. It has no freshness precondition
 * and may stand alone, in which case only rewards already harvested into the vault are
 * payable; harvesting first in the same block picks up the latest.
 *
 * Returns a zero-valued coin rather than aborting when nothing is claimable — the object
 * still has to be consumed. Prefer omitting the call when the claimable amount is zero,
 * so the recipient does not accumulate empty coin objects.
 */
export function claimRewardPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  args: {
    receipt: TransactionObjectArgument
    rewardCoinType: string
  }
): TransactionObjectArgument {
  return tx.moveCall({
    target: target(ctx.packageId, 'claim_reward'),
    typeArguments: [ctx.descriptor.coinType, args.rewardCoinType],
    arguments: [tx.object(ctx.descriptor.vault), args.receipt, tx.object(ctx.sharedObjects.clock)]
  })
}

/** Appends `create_receipt` and returns the new receipt. */
export function createReceiptPTB(tx: Transaction, ctx: VaultTxContext): TransactionObjectArgument {
  return tx.moveCall({
    target: target(ctx.packageId, 'create_receipt'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [tx.object(ctx.descriptor.vault)]
  })
}

/** Appends `get_total_assets`, whose value is only meaningful after a sync prologue. */
export function getTotalAssetsPTB(tx: Transaction, ctx: VaultTxContext): Transaction {
  tx.moveCall({
    target: target(ctx.packageId, 'get_total_assets'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [tx.object(ctx.descriptor.vault)]
  })
  return tx
}

/** Appends `get_user_shares` for a receipt. Needs no sync prologue. */
export function getUserSharesPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  receiptId: string
): Transaction {
  tx.moveCall({
    target: target(ctx.packageId, 'get_user_shares'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [tx.object(ctx.descriptor.vault), tx.object(receiptId)]
  })
  return tx
}

/** Appends `get_user_balance` for a receipt. Only meaningful after a sync prologue. */
export function getUserBalancePTB(
  tx: Transaction,
  ctx: VaultTxContext,
  receiptId: string
): Transaction {
  tx.moveCall({
    target: target(ctx.packageId, 'get_user_balance'),
    typeArguments: [ctx.descriptor.coinType],
    arguments: [tx.object(ctx.descriptor.vault), tx.object(receiptId)]
  })
  return tx
}

/**
 * Appends `get_user_claimable_reward_amount`.
 *
 * The value is a double-stale snapshot: the rule index only advances on harvest, and the
 * holder's accrued total only advances when that holder interacts with the vault. An
 * accurate figure requires simulating the settlement path instead — see `previewClaimReward`.
 */
export function getClaimableRewardPTB(
  tx: Transaction,
  ctx: VaultTxContext,
  args: { receiptId: string; rewardCoinType: string }
): Transaction {
  tx.moveCall({
    target: target(ctx.packageId, 'get_user_claimable_reward_amount'),
    typeArguments: [ctx.descriptor.coinType, args.rewardCoinType],
    arguments: [tx.object(ctx.descriptor.vault), tx.object(args.receiptId)]
  })
  return tx
}
