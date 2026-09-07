import { VaultSdkError, VaultSdkErrorCode } from './error'

/** One entry in {@link VAULT_MOVE_ABORTS}. */
export type MoveAbortSpec = {
  /** The Move constant's name, e.g. `ERR_VAULT_NOT_NORMAL`. */
  name: string
  /** The `volo_vault` module the constant is declared in. */
  module: string
  /** What the condition means, and what (if anything) resolves it. */
  message: string
  /** The {@link VaultSdkErrorCode} this abort maps onto. */
  code: VaultSdkErrorCode
}

/**
 * The user-facing aborts a vault deposit, withdrawal, or cancellation can hit, keyed by
 * abort code.
 *
 * Only `user_entry` (4xxx) and `vault` (5xxx) are listed: those are the modules this SDK
 * calls into, and their two ranges do not collide. Operator- and curator-facing modules
 * reuse the same low numbers under a different meaning, so codes outside these ranges are
 * deliberately left undecoded rather than guessed at.
 */
export const VAULT_MOVE_ABORTS: Record<number, MoveAbortSpec> = {
  4001: {
    name: 'ERR_INSUFFICIENT_BALANCE',
    module: 'user_entry',
    message: 'The receipt holds fewer shares than the request asked to burn.',
    code: 'INSUFFICIENT_BALANCE'
  },
  4002: {
    name: 'ERR_VAULT_ID_MISMATCH',
    module: 'user_entry',
    message: 'The receipt belongs to a different vault than the one being called.',
    code: 'INVALID_ARGUMENT'
  },
  4003: {
    name: 'ERR_WITHDRAW_LOCKED',
    module: 'user_entry',
    message:
      "The receipt is still inside the vault's withdraw lock, which runs from its last executed deposit.",
    code: 'RECEIPT_UNAVAILABLE'
  },
  4004: {
    name: 'ERR_INVALID_AMOUNT',
    module: 'user_entry',
    message: 'The amount or share count was zero.',
    code: 'INVALID_AMOUNT'
  },
  5009: {
    name: 'ERR_UNEXPECTED_SLIPPAGE',
    module: 'vault',
    message:
      'The payout would fall below the floor the request carried. Re-read the vault and derive a current bound.',
    code: 'SLIPPAGE_EXCEEDED'
  },
  5013: {
    name: 'ERR_INVALID_VERSION',
    module: 'vault',
    message:
      "The vault object's schema version does not match the package being called. The configured package address is behind the deployed one; no retry or argument change works around it.",
    code: 'UNSUPPORTED_CONFIG_VERSION'
  },
  5017: {
    name: 'ERR_WRONG_RECEIPT_STATUS',
    module: 'vault',
    message:
      'The receipt already carries a request that blocks this one. Settle or cancel it first.',
    code: 'RECEIPT_UNAVAILABLE'
  },
  5018: {
    name: 'ERR_REQUEST_CANCEL_TIME_NOT_REACHED',
    module: 'vault',
    message: "The request's cancel window has not opened yet; see `PendingRequest.executeTime`.",
    code: 'RECEIPT_UNAVAILABLE'
  },
  5019: {
    name: 'ERR_EXCEED_RECEIPT_SHARES',
    module: 'vault',
    message: 'The request asked to burn more shares than the receipt holds.',
    code: 'INSUFFICIENT_BALANCE'
  },
  5022: {
    name: 'ERR_VAULT_NOT_NORMAL',
    module: 'vault',
    message:
      'The vault is locked or mid-operation, so it rejects user requests regardless of how the call was built. Transient: retry once it returns to normal.',
    code: 'VAULT_NOT_OPEN'
  }
}

/** A decoded Move abort. */
export type DecodedMoveAbort = MoveAbortSpec & {
  /** The raw abort code. */
  abortCode: number
  /** The module named in the error text, when it carried one. */
  abortedIn?: string
}

/**
 * Ordered from most to least specific.
 *
 * The `MoveAbort` pattern is greedy on purpose: a `MoveLocation` carries its own commas,
 * parentheses and numbers (`function: 5, instruction: 42`), and the abort code is the last
 * `, <digits>)` in the expression — a lazy match picks up an instruction offset instead.
 */
const ABORT_CODE_PATTERNS = [
  /abort[\s_]?[cC]ode"?\s*[:=]\s*"?(\d+)/,
  /MoveAbort\(.*,\s*(\d+)\s*\)/s,
  /abort(?:ed)?\s+(?:with\s+)?(?:code\s+)?(\d+)/i
]

function toText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; error?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    if (typeof maybe.error === 'string') return maybe.error
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

/**
 * Decodes a Move abort raised by a vault call into its constant name, meaning, and the
 * {@link VaultSdkErrorCode} it corresponds to.
 *
 * PTB builders cannot see aborts — they happen when the caller dry-runs or executes the
 * transaction — so pass whatever the dry-run or execution rejected with. Accepts a thrown
 * error, an error string, or an execution status object.
 *
 * @param error - The rejection to decode
 * @returns The decoded abort, or `undefined` when the input carries no abort code (a network
 *          failure, say) or carries one outside the two decoded modules
 */
export function parseMoveAbort(error: unknown): DecodedMoveAbort | undefined {
  const text = toText(error)
  if (!text) return undefined

  let abortCode: number | undefined
  for (const pattern of ABORT_CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) {
      abortCode = Number(match[1])
      break
    }
  }
  if (abortCode === undefined) return undefined

  const spec = VAULT_MOVE_ABORTS[abortCode]
  if (!spec) return undefined

  const abortedIn = text.match(/::(\w+)::\w+/)?.[1]
  return { ...spec, abortCode, abortedIn }
}

/**
 * Wraps a Move abort as a {@link VaultSdkError} carrying the same `code` the SDK's own
 * pre-flight checks raise, so a caller can branch on one set of codes whether a condition
 * was caught before building or by the chain.
 *
 * @param error - The rejection to convert
 * @returns The typed error, or `undefined` when `error` carries no decodable vault abort —
 *          in which case rethrow the original rather than relabeling it
 */
export function asVaultSdkError(error: unknown): VaultSdkError | undefined {
  const abort = parseMoveAbort(error)
  if (!abort) return undefined
  return new VaultSdkError(abort.code, `${abort.name} (${abort.abortCode}): ${abort.message}`, {
    cause: error,
    details: {
      abort: {
        code: abort.abortCode,
        name: abort.name,
        module: abort.abortedIn ?? abort.module
      }
    }
  })
}
