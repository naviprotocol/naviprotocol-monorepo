/**
 * Vault Withdrawals
 *
 * @module VaultWithdraw
 */

import { Transaction } from '@mysten/sui/transactions'
import { getVaultConfig, MAX_U64, resolveVault } from './config'
import { NaviVaultError } from './errors'
import { getVaultLayout, selectHarvestableRules } from './layout'
import { resolveMarket } from './market'
import { appendOracleProloguePTB } from './oracle'
import { appendFreshnessPTB, createTxContext, withdrawPTB } from './ptb'
import { assertOperable } from './deposit'
import { previewWithdraw } from './quote'
import type { VaultBuildOptions, VaultIdentifier, WithdrawArgs } from './types'

/**
 * Builds a complete withdrawal transaction.
 *
 * Command order is fixed and each part is load-bearing:
 *
 * 1. oracle price update — `withdraw` takes `PriceOracle` immutably and cannot refresh
 *    it, and NAVI's collateral valuation asserts freshness even for a debt-free vault.
 *    Omitting this aborts 1502.
 * 2. one `sync_market_balance` per registered market, Disabled ones included.
 * 3. one `collect_reward` per active market reward rule.
 * 4. `withdraw`, then the produced coin is transferred to the holder.
 *
 * The idle balance is drawn down first; `poolId` designates the source of the shortfall
 * only. When idle covers the whole amount, no penalty applies regardless of routing.
 *
 * `maxShares` is required and must be non-zero — `0n` disables slippage protection
 * entirely. Use {@link buildWithdrawTxWithPreview} to derive it automatically.
 */
export async function buildWithdrawTx(
  args: WithdrawArgs,
  options?: VaultBuildOptions & { updatePythPriceFeeds?: boolean }
): Promise<Transaction> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)
  const fromDefault = args.fromDefault ?? true

  assertOperable(layout, 'Withdrawal', config.package.expectedVaultVersion)

  if (args.amount <= 0n) {
    throw new NaviVaultError({
      code: 10034,
      name: 'E_INVALID_AMOUNT',
      kind: 'user',
      message: 'Withdrawal amount must be greater than zero.',
      raw: String(args.amount)
    })
  }

  if (args.maxShares <= 0n) {
    throw new NaviVaultError({
      code: 10040,
      name: 'E_SLIPPAGE_EXCEEDED',
      kind: 'user',
      message:
        'maxShares must be greater than zero. The contract treats 0 as "no limit", not "no ' +
        'shares", so passing it would submit the withdrawal with slippage protection disabled. ' +
        'Derive it with previewWithdraw, or use buildWithdrawTxWithPreview.',
      raw: String(args.maxShares)
    })
  }

  const market = resolveMarket(layout, { fromDefault, poolId: args.poolId })

  const tx = new Transaction()
  tx.setSenderIfNotSet(args.sender)

  await appendOracleProloguePTB(tx, descriptor, options)
  appendFreshnessPTB(tx, ctx, layout, selectHarvestableRules(layout, descriptor))

  const [coin] = withdrawPTB(tx, ctx, {
    market,
    receipt: tx.object(args.receiptId),
    amount: args.amount,
    maxShares: args.maxShares,
    fromDefault
  })

  if (coin) {
    tx.transferObjects([coin], tx.pure.address(args.sender))
  }

  return tx
}

/**
 * Simulates the withdrawal to derive `maxShares`, then builds it.
 *
 * Two round trips instead of one, in exchange for a slippage bound that accounts for the
 * market penalty, ceiling rounding, idle-first routing and same-transaction fee accrual
 * — none of which `convert_to_shares` models.
 *
 * Both calls read the layout; the second reuses the first's, so a market added between
 * them is caught by the on-chain assertion rather than silently ignored.
 */
export async function buildWithdrawTxWithPreview(
  args: Omit<WithdrawArgs, 'maxShares'>,
  options?: VaultBuildOptions & { toleranceBps?: number; updatePythPriceFeeds?: boolean }
): Promise<{ transaction: Transaction; maxShares: bigint; sharesBurned: bigint }> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))

  const preview = await previewWithdraw(args, { ...options, layout })
  const transaction = await buildWithdrawTx(
    { ...args, maxShares: preview.maxShares },
    { ...options, layout }
  )

  return { transaction, maxShares: preview.maxShares, sharesBurned: preview.sharesBurned }
}

/**
 * Builds a full exit.
 *
 * Uses `fromDefault` with `MAX_U64`: the contract clamps the amount to the holder's
 * maximum redeemable value, and the default market carries no penalty, so the
 * shares-to-assets relationship stays linear.
 *
 * This normally clears the position exactly. The exception is the sole remaining holder:
 * the virtual-share offset that protects against inflation attacks means redeeming the
 * full asset balance would require burning `total_shares + VIRTUAL_SHARES`, which they do
 * not have, so they may need a second withdrawal or leave a small remainder. Multi-holder
 * exits are unaffected. Read the returned coin value rather than assuming either way.
 */
export async function buildExitAllTx(
  args: { vault: VaultIdentifier; receiptId: string; sender: string },
  options?: VaultBuildOptions & { toleranceBps?: number; updatePythPriceFeeds?: boolean }
): Promise<{ transaction: Transaction; maxShares: bigint; sharesBurned: bigint }> {
  return buildWithdrawTxWithPreview({ ...args, amount: MAX_U64, fromDefault: true }, options)
}
