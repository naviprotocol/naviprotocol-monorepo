/**
 * Vault Market Selection
 *
 * Resolves which registered market a deposit or withdrawal should be pointed at.
 *
 * @module VaultMarket
 */

import { isZeroAddress } from './config'
import { NaviVaultError } from './errors'
import type { MarketLayout, VaultLayout } from './types'
import { MarketStatus } from './types'
import { isSameAddress } from './utils'

/** Finds a market by pool id, in any address padding. */
export function findMarket(layout: VaultLayout, poolId: string): MarketLayout | undefined {
  return layout.markets.find((market) => isSameAddress(market.poolId, poolId))
}

/**
 * Returns the vault's deposit routing target, or `undefined` when unset.
 *
 * An unset default market (`0x0`) means deposits accumulate in the idle balance rather
 * than being forwarded into NAVI. The pool argument is still type-required in that case
 * but is neither validated nor used for routing.
 */
export function getDefaultMarket(layout: VaultLayout): MarketLayout | undefined {
  if (isZeroAddress(layout.defaultMarket)) return undefined
  return findMarket(layout, layout.defaultMarket)
}

/**
 * Resolves the market to use for a withdrawal's shortfall.
 *
 * With `fromDefault`, the contract requires the default market and applies no penalty.
 * Without it, any registered market may be drawn from — Disabled included, since market
 * status is not checked on withdrawal, so a market being wound down stays drainable —
 * and that market's penalty applies to the portion actually taken from it.
 */
export function resolveMarket(
  layout: VaultLayout,
  args: { fromDefault: boolean; poolId?: string }
): MarketLayout {
  if (args.fromDefault) {
    const market = getDefaultMarket(layout)
    if (!market) {
      throw new NaviVaultError({
        code: 10022,
        name: 'E_DEFAULT_MARKET_MISMATCH',
        kind: 'config',
        message:
          'fromDefault was requested but the vault has no default market set. Pass an explicit ' +
          'poolId with fromDefault disabled, or draw on the idle balance.',
        raw: layout.defaultMarket
      })
    }
    if (args.poolId && !isSameAddress(args.poolId, market.poolId)) {
      throw new NaviVaultError({
        code: 10022,
        name: 'E_DEFAULT_MARKET_MISMATCH',
        kind: 'user',
        message:
          `fromDefault requires the default market (${market.poolId}), but ${args.poolId} was ` +
          `given. Disable fromDefault to withdraw from a non-default market — note that it ` +
          `applies that market's penalty.`,
        raw: args.poolId
      })
    }
    return market
  }

  if (!args.poolId) {
    const fallback = getDefaultMarket(layout) ?? layout.markets[0]
    if (!fallback) {
      throw new NaviVaultError({
        code: 10003,
        name: 'E_MARKET_NOT_FOUND',
        kind: 'config',
        message: 'The vault has no registered markets.',
        raw: ''
      })
    }
    return fallback
  }

  const market = findMarket(layout, args.poolId)
  if (!market) {
    throw new NaviVaultError({
      code: 10003,
      name: 'E_MARKET_NOT_FOUND',
      kind: 'user',
      message:
        `Market ${args.poolId} is not registered on this vault. Registered: ` +
        `${layout.markets.map((entry) => entry.poolId).join(', ') || '(none)'}.`,
      raw: args.poolId
    })
  }
  return market
}

/**
 * Resolves the market a deposit must be routed to.
 *
 * Deposits go only to the default market — any other pool aborts
 * `E_DEFAULT_MARKET_MISMATCH` (10022) — and it must be Active.
 *
 * Returns `undefined` when no default market is set, meaning the deposit accumulates in
 * the idle balance. The caller must still supply some registered market's objects to
 * satisfy the signature.
 */
export function resolveDepositMarket(layout: VaultLayout): MarketLayout | undefined {
  const market = getDefaultMarket(layout)
  if (!market) return undefined

  if (market.status !== MarketStatus.Active) {
    throw new NaviVaultError({
      code: 10010,
      name: 'E_MARKET_INVALID',
      kind: 'outage',
      message:
        `The vault's default market ${market.poolId} is Disabled and cannot receive deposits. ` +
        `Withdrawals from it still work.`,
      raw: market.poolId
    })
  }
  return market
}

/**
 * Remaining headroom on a market's own cap, in native decimals, or `null` when uncapped.
 *
 * This is one of three bounds on a deposit. The others are the vault cap and NAVI's
 * reserve supply ceiling, the last of which is shared with every other participant in
 * that reserve — including other vaults registered on the same market — and cannot be
 * derived from vault state at all.
 */
export function marketDepositHeadroom(market: MarketLayout): bigint | null {
  if (market.cap === 0n) return null
  return market.cap > market.currentBalance ? market.cap - market.currentBalance : 0n
}
