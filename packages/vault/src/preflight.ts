import { parseToUnits } from '@mysten/sui/utils'
import type { Vault } from './types'
import { vaultErrors } from './error'

/**
 * Vault statuses that reject user requests on chain, and which operations they reject.
 *
 * A `lock` vault aborts `5022 ERR_VAULT_NOT_NORMAL` on every deposit and withdrawal, so
 * building the PTB at all only defers a certain failure to the dry run. Any status not
 * listed here is passed through and left to the chain to accept or reject — an unrecognized
 * status is not grounds for this SDK to refuse to build.
 */
const BLOCKED_BY_STATUS: Record<string, ('deposit' | 'withdraw')[]> = {
  lock: ['deposit', 'withdraw']
}

/**
 * Rejects an operation the vault's status is known to abort.
 *
 * @param vault - The vault the operation targets
 * @param operation - Which operation is being built
 * @throws VaultSdkError with code `VAULT_NOT_OPEN` when the vault's status rejects it
 */
export function checkVaultAccepts(vault: Vault, operation: 'deposit' | 'withdraw') {
  const status = vault.status?.toLowerCase()
  if (status && BLOCKED_BY_STATUS[status]?.includes(operation)) {
    throw vaultErrors.vaultNotOpen(vault.id, operation, vault.status)
  }
}

/** Human-unit vault figure -> raw base units, or `undefined` when it is unusable. */
function toRawUnits(value: number | null, decimals: number): bigint | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  try {
    return parseToUnits(value.toFixed(decimals), decimals)
  } catch {
    return undefined
  }
}

/**
 * Rejects a deposit that falls outside the vault's advertised bounds.
 *
 * Both bounds come from the API snapshot, and neither is a contract invariant: the vault
 * contract does not check `minInvestment` at all, and it prices the cap against its own
 * state at execution time rather than the snapshot. These are the product rules the NAVI
 * front end applies, enforced here so an integrator's users hit the same limits and learn
 * about them before paying gas. A bound the API does not report is not enforced.
 *
 * @param vault - The vault the deposit targets
 * @param amount - Deposit amount in raw base units
 * @throws VaultSdkError with code `DEPOSIT_BELOW_MINIMUM` or `DEPOSIT_CAP_EXCEEDED`
 */
export function checkDepositAmount(vault: Vault, amount: bigint) {
  const decimals = vault.assets.baseCoin.decimals

  const minimum = toRawUnits(vault.minInvestment, decimals)
  if (minimum !== undefined && minimum > 0n && amount < minimum) {
    throw vaultErrors.depositBelowMinimum(vault.id, amount, minimum)
  }

  const cap = toRawUnits(vault.stakeCapAmount, decimals)
  const staked = toRawUnits(vault.totalStaked, decimals)
  if (cap !== undefined && cap > 0n && staked !== undefined) {
    const headroom = cap > staked ? cap - staked : 0n
    if (amount > headroom) {
      throw vaultErrors.depositCapExceeded(vault.id, amount, headroom)
    }
  }
}
