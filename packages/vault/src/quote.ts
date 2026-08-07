/**
 * Vault Pricing
 *
 * Every figure here is produced by simulating a block that synchronizes the vault's
 * markets before reading. This is not an optimization: `MarketInfo.current_balance` is
 * written only by `sync_market_balance`, which happens as a side effect of someone
 * constructing a deposit, withdrawal or allocation. A vault with no recent activity is
 * not synchronized at all, and mainnet vaults have carried snapshots more than a month
 * old. Reading the vault object's fields directly would report that stale figure with no
 * indication of its age.
 *
 * Simulation discards the mutable references, so nothing is written on chain and no
 * signature, key or funded account is required.
 *
 * @module VaultQuote
 */

import { Transaction } from '@mysten/sui/transactions'
import { getVaultConfig, resolveVault } from './config'
import { getVaultLayout, selectHarvestableRules } from './layout'
import { appendOracleProloguePTB } from './oracle'
import {
  appendFreshnessPTB,
  appendSyncMarketsPTB,
  createTxContext,
  getTotalAssetsPTB,
  getUserBalancePTB,
  getUserSharesPTB,
  withdrawPTB
} from './ptb'
import type {
  VaultBuildOptions,
  VaultIdentifier,
  VaultLayout,
  VaultPosition,
  VaultQuote,
  VaultReadOptions
} from './types'
import { decode, decodeOne, simulate, tryDecodeCoinBalance } from './utils'
import { resolveMarket } from './market'

/**
 * Reads a vault's assets, shares and per-market balances against a freshly synchronized
 * snapshot.
 */
export async function getVaultQuote(
  identifier: VaultIdentifier,
  options?: VaultReadOptions & { layout?: VaultLayout }
): Promise<VaultQuote> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(identifier, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)

  const tx = new Transaction()
  appendSyncMarketsPTB(tx, ctx, layout)
  getTotalAssetsPTB(tx, ctx)

  const marketCommandBase = layout.markets.length + 1
  for (const market of layout.markets) {
    tx.moveCall({
      target: `${ctx.packageId}::navi_vault::get_market_info`,
      typeArguments: [descriptor.coinType],
      arguments: [tx.object(descriptor.vault), tx.pure.address(market.poolId)]
    })
  }

  const results = await simulate(tx, options)

  const totalAssets = decodeOne(results, layout.markets.length, decode.u64, 'get_total_assets')
  const marketBalances: Record<string, bigint> = {}
  layout.markets.forEach((market, index) => {
    marketBalances[market.poolId] = decodeOne(
      results,
      marketCommandBase + index,
      decode.u64,
      `get_market_info[${market.poolId}]`
    )
  })

  const depositHeadroom =
    layout.vaultCap === 0n
      ? null
      : layout.vaultCap > totalAssets
        ? layout.vaultCap - totalAssets
        : 0n

  return {
    totalAssets,
    totalShares: layout.totalShares,
    idleBalance: layout.idleBalance,
    marketBalances,
    depositHeadroom
  }
}

/**
 * Values a holder's receipts against a synchronized snapshot.
 *
 * Each receipt is an independent position; a holder with several against one vault gets
 * one entry per receipt, never a merged total.
 */
export async function getVaultPositions(
  receiptIds: string[],
  identifier: VaultIdentifier,
  options?: VaultReadOptions & { layout?: VaultLayout }
): Promise<VaultPosition[]> {
  if (receiptIds.length === 0) return []

  const config = await getVaultConfig(options)
  const descriptor = resolveVault(identifier, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)

  const tx = new Transaction()
  appendSyncMarketsPTB(tx, ctx, layout)
  for (const receiptId of receiptIds) {
    getUserSharesPTB(tx, ctx, receiptId)
    getUserBalancePTB(tx, ctx, receiptId)
  }

  const results = await simulate(tx, options)
  const base = layout.markets.length

  return receiptIds.map((receiptId, index) => ({
    receiptId,
    shares: decodeOne(results, base + index * 2, decode.u64, `get_user_shares[${receiptId}]`),
    balance: decodeOne(results, base + index * 2 + 1, decode.u64, `get_user_balance[${receiptId}]`)
  }))
}

/** Result of simulating a withdrawal. */
export type WithdrawPreview = {
  /** Shares the withdrawal would burn, as computed by the contract. */
  sharesBurned: bigint
  /** Assets the withdrawal would return, read from the produced coin when decodable. */
  amountOut?: bigint
  /**
   * Suggested `maxShares` — {@link sharesBurned} plus {@link toleranceBps}.
   *
   * Drift between simulation and execution is favourable: interest accrual raises share
   * price, so the same amount costs marginally fewer shares later. The tolerance covers
   * rounding and any fee accrual in the interval.
   */
  maxShares: bigint
  /** Tolerance applied, in basis points. */
  toleranceBps: number
}

/**
 * Simulates a withdrawal to derive `maxShares`.
 *
 * This is the only reliable way to size the slippage bound: `convert_to_shares` models
 * none of the non-default-market penalty, ceiling rounding, idle-first routing, or
 * same-transaction fee accrual that determine what is actually burned.
 *
 * @param amount - Amount in native decimals. Pass {@link MAX_U64} with `fromDefault` to
 *   preview a full exit.
 * @param toleranceBps - Headroom added to the simulated figure. Defaults to 30 bps.
 */
export async function previewWithdraw(
  args: {
    vault: VaultIdentifier
    receiptId: string
    amount: bigint
    sender: string
    fromDefault?: boolean
    poolId?: string
  },
  options?: VaultBuildOptions & { toleranceBps?: number; updatePythPriceFeeds?: boolean }
): Promise<WithdrawPreview> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)
  const fromDefault = args.fromDefault ?? true
  const market = resolveMarket(layout, { fromDefault, poolId: args.poolId })

  const tx = new Transaction()
  await appendOracleProloguePTB(tx, descriptor, options)
  appendFreshnessPTB(tx, ctx, layout, selectHarvestableRules(layout, descriptor))
  withdrawPTB(tx, ctx, {
    market,
    receipt: tx.object(args.receiptId),
    amount: args.amount,
    // No bound during simulation: the point of the call is to learn what the bound
    // should be, and a guessed one would abort before telling us.
    maxShares: 0n,
    fromDefault
  })

  const results = await simulate(tx, { ...options, sender: args.sender })

  // The oracle prologue's command count varies with Pyth staleness, so index from the
  // end rather than from a computed offset.
  const withdrawResult = results[results.length - 1]
  if (!withdrawResult) {
    throw new Error('Withdrawal simulation returned no results')
  }

  // withdraw returns (Coin<CoinType>, u64); the shares figure is the second value.
  const sharesBytes = withdrawResult[1]
  if (!sharesBytes) {
    throw new Error('Withdrawal simulation did not return a shares_burned value')
  }
  const sharesBurned = decode.u64(sharesBytes)

  const toleranceBps = options?.toleranceBps ?? 30
  return {
    sharesBurned,
    amountOut: tryDecodeCoinBalance(withdrawResult[0]),
    maxShares: sharesBurned + (sharesBurned * BigInt(toleranceBps)) / 10_000n,
    toleranceBps
  }
}

/**
 * Assets per share, as a float.
 *
 * Display only — lossy, and unusable for any on-chain amount. Returns 1 for an empty
 * vault, matching the contract's virtual-share behaviour at zero supply.
 */
export function sharePrice(quote: Pick<VaultQuote, 'totalAssets' | 'totalShares'>): number {
  if (quote.totalShares === 0n) return 1
  return Number(quote.totalAssets) / Number(quote.totalShares)
}
