/**
 * Vault Oracle Prologue
 *
 * `withdraw` and `deallocate` reach NAVI's collateral valuation, which asserts price
 * validity even though a vault holds no debt. A price is valid only while
 * `now - price.timestamp <= PriceOracle.update_interval`, 30 seconds by default, and the
 * vault receives `PriceOracle` by immutable reference so it cannot refresh it. Every
 * withdrawal block must therefore open with a price update, before the market
 * synchronizations, or abort 1502.
 *
 * The oracle entrypoint is versioned and its revisions accept different Pyth
 * `PriceInfoObject` types, so it is deliberately not hardcoded here. This module
 * delegates to `@naviprotocol/lending`, which resolves the entrypoint name and every
 * oracle object from NAVI's configuration service — meaning an oracle upgrade is picked
 * up without an SDK release.
 *
 * @module VaultOracle
 */

import type { Transaction } from '@mysten/sui/transactions'
import { getPriceFeeds, normalizeCoinType, updateOraclePricesPTB } from '@naviprotocol/lending'
import type { VaultBuildOptions, VaultDescriptor } from './types'

/** The only option keys `@naviprotocol/lending` understands. */
const LENDING_OPTION_KEYS = [
  'client',
  'env',
  'services',
  'market',
  'markets',
  'cacheTime',
  'disableCache'
] as const

/**
 * Narrows vault options to the subset lending accepts.
 *
 * This is not tidiness. Lending's cached entrypoints derive their cache key with
 * `JSON.stringify` over the argument list, and `JSON.stringify` throws outright on a
 * BigInt. Forwarding a vault options object wholesale passes `layout` — every amount in
 * which is a BigInt — straight into that key and fails with
 * "Do not know how to serialize a BigInt", from inside lending, nowhere near the call
 * site. Anything handed to a lending function goes through here first.
 */
export function toLendingOptions(options?: VaultBuildOptions): Record<string, unknown> | undefined {
  if (!options) return undefined
  const narrowed: Record<string, unknown> = {}
  for (const key of LENDING_OPTION_KEYS) {
    const value = (options as Record<string, unknown>)[key]
    if (value !== undefined) narrowed[key] = value
  }
  return narrowed
}

/**
 * Appends the oracle price update for a vault's underlying asset.
 *
 * Emit this first — before the market synchronizations — in any block containing
 * `withdraw`. Deposits take no oracle and must not include it.
 *
 * The refresh is per asset: updating an unrelated asset does not satisfy the assertion.
 *
 * @param updatePythPriceFeeds - Also refresh the Pyth feed on chain when it is stale.
 *   Costs an extra call and a fee coin, but the 30-second window is short enough that
 *   relying on another party to have refreshed it is not a strategy.
 */
export async function appendOracleProloguePTB(
  tx: Transaction,
  descriptor: VaultDescriptor,
  options?: VaultBuildOptions & { updatePythPriceFeeds?: boolean }
): Promise<Transaction> {
  const lendingOptions = toLendingOptions(options)
  const feeds = await getPriceFeeds(lendingOptions)
  const coinType = normalizeCoinType(descriptor.coinType)
  const matching = feeds.filter((feed) => normalizeCoinType(feed.coinType) === coinType)

  if (matching.length === 0) {
    throw new Error(
      `No oracle price feed configured for ${descriptor.coinType}. Withdrawals from ` +
        `${descriptor.displayName} will abort 1502 without one.`
    )
  }

  return updateOraclePricesPTB(tx, matching, {
    ...lendingOptions,
    updatePythPriceFeeds: options?.updatePythPriceFeeds ?? true
  })
}
