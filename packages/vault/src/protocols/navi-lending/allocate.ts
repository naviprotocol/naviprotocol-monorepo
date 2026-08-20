import { Transaction } from '@mysten/sui/transactions'
import { VaultSdkError } from '../../errors'
import type { VaultSuiClient } from '../../types'
import type { NAVILendingVault } from '../../vaults'
import { decode, decodeOne, simulate } from '../shared/simulate'

/** How much to withdraw from one receipt. `U64_MAX` drains it. */
export type ReceiptWithdrawal = {
  receiptId: string
  amount: bigint
}

/** `u64::MAX`. With `from_default`, the contract clamps it to the holder's maximum. */
export const U64_MAX = 18_446_744_073_709_551_615n

/**
 * Reads each receipt's redeemable asset value.
 *
 * `get_user_balance` is already `convert_to_assets(get_user_shares(receipt))`, so one
 * Move call per receipt is enough — and one simulated block covers all of them.
 *
 * The figures are only as fresh as the vault's last market synchronization. That is
 * acceptable here for the same reason it is in the NAVI vault backend: the plan is built
 * from a single snapshot, and the amounts passed to the contract are explicit, so a later
 * price move changes how many shares burn but not how much is withdrawn.
 */
export async function readReceiptBalances(
  client: VaultSuiClient,
  vault: NAVILendingVault,
  receipts: string[],
  sender: string
): Promise<{ receiptId: string; balance: bigint }[]> {
  const tx = new Transaction()
  for (const receiptId of receipts) {
    tx.moveCall({
      target: `${vault.contractConfig.package}::navi_vault::get_user_balance`,
      typeArguments: [vault.assets.base.coinType],
      arguments: [tx.object(vault.id), tx.object(receiptId)]
    })
  }

  const results = await simulate(client, tx, sender)
  return receipts.map((receiptId, index) => ({
    receiptId,
    balance: decodeOne(results, index, decode.u64, `get_user_balance[${receiptId}]`)
  }))
}

/**
 * Spreads a withdrawal across receipts, largest balance first.
 *
 * Receipts consumed in full are passed `U64_MAX` so the contract drains them exactly; the
 * last one takes the remainder. This mirrors the NAVI vault backend, which allocates the
 * coin amount directly rather than round-tripping through
 * `convert_to_shares → convert_to_assets` — that double flooring loses a unit.
 *
 * The backend prefers the receipt most recently deposited into, so that a small deposit
 * followed by a matching withdrawal stays on one receipt. That ordering needs deposit
 * history the SDK does not have, so this orders by balance instead: deterministic, and it
 * touches the fewest receipts.
 */
export function planWithdrawal(
  balances: { receiptId: string; balance: bigint }[],
  amount: bigint
): ReceiptWithdrawal[] {
  const funded = balances
    .filter((entry) => entry.balance > 0n)
    .sort((a, b) => (a.balance > b.balance ? -1 : 1))

  // Checked before the full-exit shortcut below: without it, a holder with nothing would
  // get an empty plan, and the caller a transaction carrying a prologue but no withdrawal.
  if (funded.length === 0) {
    throw new VaultSdkError(
      'INSUFFICIENT_BALANCE',
      "None of the owner's receipts on this vault hold a balance."
    )
  }

  if (amount === U64_MAX) {
    // Full exit: drain every funded receipt.
    return funded.map((entry) => ({ receiptId: entry.receiptId, amount: U64_MAX }))
  }

  const plan: ReceiptWithdrawal[] = []
  let remaining = amount

  for (const entry of funded) {
    if (remaining === 0n) break
    if (remaining >= entry.balance) {
      plan.push({ receiptId: entry.receiptId, amount: U64_MAX })
      remaining -= entry.balance
    } else {
      plan.push({ receiptId: entry.receiptId, amount: remaining })
      remaining = 0n
    }
  }

  if (remaining > 0n) {
    const total = funded.reduce((sum, entry) => sum + entry.balance, 0n)
    throw new VaultSdkError(
      'INSUFFICIENT_BALANCE',
      `Requested ${amount} but the owner's receipts hold ${total} in total.`
    )
  }

  return plan
}
