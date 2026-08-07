/**
 * Vault Deposits
 *
 * @module VaultDeposit
 */

import { Transaction } from '@mysten/sui/transactions'
import type { TransactionObjectArgument } from '@mysten/sui/transactions'
import { normalizeCoinType } from '@naviprotocol/lending'
import { getVaultConfig, resolveVault } from './config'
import { NaviVaultError } from './errors'
import { findReceipts, getVaultLayout, selectHarvestableRules } from './layout'
import { resolveDepositMarket } from './market'
import { appendFreshnessPTB, createTxContext, depositPTB } from './ptb'
import type { DepositArgs, VaultBuildOptions, VaultLayout } from './types'
import { throwVaultError } from './errors'

const SUI_COIN_TYPE = '0x2::sui::SUI'

/**
 * Throws when the vault cannot currently accept operations.
 *
 * Covers the two preconditions the contract enforces on every entrypoint — pause state
 * and contract version. Checking version here matters: a vault left unmigrated after a
 * package upgrade aborts `E_INCORRECT_VERSION` on every call, and without this the
 * caller would pay gas to discover that.
 */
export function assertOperable(layout: VaultLayout, label: string, expectedVersion?: number): void {
  if (layout.paused) {
    throw new NaviVaultError({
      code: 10011,
      name: 'E_PAUSED',
      kind: 'outage',
      message: `${label} is unavailable: the vault is paused.`,
      raw: 'paused'
    })
  }

  if (expectedVersion !== undefined && layout.version !== BigInt(expectedVersion)) {
    throw new NaviVaultError({
      code: 10036,
      name: 'E_INCORRECT_VERSION',
      kind: 'outage',
      message:
        `${label} is unavailable: the vault object is at version ${layout.version} but the ` +
        `configured package expects ${expectedVersion}. Either the vault has not been ` +
        `migrated after a package upgrade, or the configured packageId is stale. Every ` +
        `entrypoint aborts 10036 until they agree.`,
      raw: `${layout.version} != ${expectedVersion}`
    })
  }
}

/** Sentinel for {@link DepositArgs.position} meaning "open a fresh position". */
export const NEW_POSITION = 'new'

/**
 * Decides which receipt a deposit should credit.
 *
 * Reuses the sender's existing receipt when they hold exactly one, and returns
 * `undefined` — mint a new one — when they hold none. Holding several is ambiguous: each
 * receipt is a separate position, and silently topping one up is precisely what leaves
 * stray empty receipts behind, so the caller is asked to choose.
 *
 * Costs one read (~60ms). Skipped entirely when the caller has already decided.
 */
export async function resolveDepositReceipt(
  args: Pick<DepositArgs, 'vault' | 'sender' | 'position'>,
  options?: VaultBuildOptions
): Promise<string | undefined> {
  if (args.position === NEW_POSITION) return undefined
  if (args.position) return args.position

  const receipts = await findReceipts(args.sender, args.vault, options)
  if (receipts.length === 0) return undefined
  if (receipts.length === 1) return receipts[0]!.objectId

  throw new NaviVaultError({
    code: 0,
    name: 'AMBIGUOUS_RECEIPT',
    kind: 'user',
    message:
      `The sender holds ${receipts.length} receipts on this vault, so which position to ` +
      `credit is ambiguous. Pass position: '<receiptId>' to top one up, or ` +
      `position: 'new' to open another. Receipts: ` +
      `${receipts.map((receipt) => receipt.objectId).join(', ')}.`,
    raw: receipts.map((receipt) => receipt.objectId).join(',')
  })
}

/**
 * Produces a coin argument holding exactly `amount`.
 *
 * The contract asserts `deposit_coin.value() == amount` and aborts `E_AMOUNT_MISMATCH`
 * (10021) otherwise, so an approximate coin is never acceptable.
 *
 * For SUI this splits from the gas coin. For every other asset it gathers the owner's
 * coin objects, merges them and splits — the owner's balance may be spread across many
 * objects, and a single one is rarely large enough.
 */
export async function prepareDepositCoin(
  tx: Transaction,
  args: { owner: string; coinType: string; amount: bigint },
  options?: VaultBuildOptions
): Promise<TransactionObjectArgument> {
  const coinType = normalizeCoinType(args.coinType)

  if (coinType === normalizeCoinType(SUI_COIN_TYPE)) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.amount)])
    return coin as TransactionObjectArgument
  }

  const core = (options?.client as { core?: unknown } | undefined)?.core as
    | {
        listCoins?(input: unknown): Promise<{
          objects: { objectId: string; balance: string }[]
          cursor?: string | null
          hasNextPage?: boolean
        }>
      }
    | undefined

  if (typeof core?.listCoins !== 'function') {
    throw new Error(
      `Depositing ${args.coinType} requires a Sui v2 Core-capable client to select coin objects, ` +
        `or an explicit coin argument.`
    )
  }

  const owned: { objectId: string; balance: bigint }[] = []
  let total = 0n
  let cursor: string | null | undefined

  do {
    let page
    try {
      page = await core.listCoins({ owner: args.owner, coinType, cursor })
    } catch (error) {
      throwVaultError(error)
    }
    for (const coin of page.objects) {
      const balance = BigInt(coin.balance)
      if (balance === 0n) continue
      owned.push({ objectId: coin.objectId, balance })
      total += balance
    }
    // Same guard as findReceipts: never re-request a cursor we just used.
    const nextCursor = page.hasNextPage ? (page.cursor ?? null) : null
    cursor = nextCursor && nextCursor !== cursor ? nextCursor : null
  } while (cursor)

  if (total < args.amount) {
    throw new NaviVaultError({
      code: 10002,
      name: 'E_INSUFFICIENT_BALANCE',
      kind: 'user',
      message: `Owner holds ${total} of ${args.coinType}, needs ${args.amount}.`,
      raw: `${total} < ${args.amount}`
    })
  }

  const [primary, ...rest] = owned
  if (!primary) {
    throw new NaviVaultError({
      code: 10002,
      name: 'E_INSUFFICIENT_BALANCE',
      kind: 'user',
      message: `Owner holds no ${args.coinType} coin objects.`,
      raw: '0'
    })
  }

  const primaryArg = tx.object(primary.objectId)
  if (rest.length > 0) {
    tx.mergeCoins(
      primaryArg,
      rest.map((coin) => tx.object(coin.objectId))
    )
  }

  const [coin] = tx.splitCoins(primaryArg, [tx.pure.u64(args.amount)])
  return coin as TransactionObjectArgument
}

/**
 * Builds a complete deposit transaction.
 *
 * The block is `M + R + 1` Move calls plus coin handling: every registered market
 * synchronized, every active market reward rule harvested, then `deposit`. No oracle
 * update is emitted — `logic::execute_deposit` takes no oracle and performs no price
 * read.
 *
 * The layout is read at build time and must not be reused for a later transaction.
 *
 * Deposit headroom is the minimum of three bounds and only two are checked here: the
 * third is NAVI's reserve supply ceiling, which is shared with every other participant
 * in that reserve and can abort the deposit with 1604 while both vault and market caps
 * still have room.
 *
 * The position credited is resolved by {@link resolveDepositReceipt}: the sender's
 * existing receipt is topped up when they hold exactly one, and a new one is minted when
 * they hold none. Pass `position` to decide explicitly and skip the lookup.
 */
export async function buildDepositTx(
  args: DepositArgs,
  options?: VaultBuildOptions
): Promise<Transaction> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)

  assertOperable(layout, 'Deposit', config.package.expectedVaultVersion)

  if (args.amount <= 0n) {
    throw new NaviVaultError({
      code: 10034,
      name: 'E_INVALID_AMOUNT',
      kind: 'user',
      message: 'Deposit amount must be greater than zero.',
      raw: String(args.amount)
    })
  }

  // Cap checks are deliberately left to the contract. Both the vault cap and the market
  // cap are compared against balances that are only refreshed by the sync commands this
  // very block emits, so any figure available at build time is stale — pre-checking it
  // here could reject a deposit that would in fact succeed. Use getVaultQuote for a
  // synchronized headroom figure to show a user, and let E_CAP_EXCEEDED /
  // E_VAULT_CAP_EXCEEDED be authoritative.
  const market = resolveDepositMarket(layout)
  if (!market) {
    throw new NaviVaultError({
      code: 10022,
      name: 'E_DEFAULT_MARKET_MISMATCH',
      kind: 'config',
      message:
        'The vault has no default market, so deposits would accumulate in the idle balance. ' +
        'This SDK does not build idle-only deposits — confirm the vault configuration first.',
      raw: layout.defaultMarket
    })
  }

  // Resolved before the transaction is opened: reuse the sender's position when there is
  // one, mint when there is none. Without this every deposit opens a new position and
  // leaves the previous one behind.
  const receiptId = await resolveDepositReceipt(args, options)

  const tx = new Transaction()
  tx.setSenderIfNotSet(args.sender)

  appendFreshnessPTB(tx, ctx, layout, selectHarvestableRules(layout, descriptor))

  const coin =
    args.coin !== undefined
      ? (tx.splitCoins(args.coin, [tx.pure.u64(args.amount)])[0] as TransactionObjectArgument)
      : await prepareDepositCoin(
          tx,
          { owner: args.sender, coinType: descriptor.coinType, amount: args.amount },
          options
        )

  const [receipt] = depositPTB(tx, ctx, {
    market,
    coin,
    amount: args.amount,
    receipt: receiptId ? tx.object(receiptId) : undefined
  })

  // The returned receipt is a hot potato — it must be consumed. When adding to an
  // existing position the same object is handed straight back, so this returns it to
  // its owner rather than creating anything new.
  if (receipt) {
    tx.transferObjects([receipt], tx.pure.address(args.sender))
  }

  return tx
}
