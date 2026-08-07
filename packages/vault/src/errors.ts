/**
 * Vault Error Classification
 *
 * A vault transaction can abort from three different packages, and the codes overlap in
 * meaning but not in remedy. `navi_vault` raises 10001–10042; `lending_core` and the
 * oracle raise their own, and those are the ones most likely to be misreported as user
 * error when they are not.
 *
 * @module VaultErrors
 */

/**
 * What the caller should do about an abort.
 *
 * - `user` — the request itself is wrong. Fix the arguments.
 * - `transient` — valid request, momentarily unsatisfiable. Retrying may work.
 * - `liquidity` — the underlying reserve cannot release the assets right now. Route
 *   elsewhere or wait.
 * - `outage` — the operation is unavailable for reasons outside the caller's control.
 *   Never present as user error. How far the unavailability reaches varies by code; the
 *   per-code message says so (1400 halts everything, E_MARKET_INVALID only blocks
 *   inflows).
 * - `config` — the SDK's configuration disagrees with chain state.
 * - `unknown` — unrecognized code.
 */
export type VaultErrorKind = 'user' | 'transient' | 'liquidity' | 'outage' | 'config' | 'unknown'

/** A decoded abort. */
export type VaultError = {
  /** Numeric abort code. */
  code: number
  /** Move module that raised it, when recoverable from the message. */
  module?: string
  /** Stable symbolic name, e.g. `E_MARKET_NOT_READ`. */
  name: string
  kind: VaultErrorKind
  /** What went wrong and what to do about it. */
  message: string
  /** Original error text. */
  raw: string
}

type ErrorSpec = { name: string; kind: VaultErrorKind; message: string }

/** navi_vault abort codes. Source: `sources/navi_vault.move`. */
const VAULT_ERRORS: Record<number, ErrorSpec> = {
  10001: { name: 'E_UNAUTHORIZED', kind: 'user', message: 'Caller lacks the required capability.' },
  10002: {
    name: 'E_INSUFFICIENT_BALANCE',
    kind: 'user',
    message:
      'The vault or the holder does not hold enough to satisfy this amount. Distinct from reserve illiquidity (1506).'
  },
  10003: { name: 'E_MARKET_NOT_FOUND', kind: 'config', message: 'Market is not registered.' },
  10004: {
    name: 'E_TIMELOCK_NOT_EXPIRED',
    kind: 'user',
    message: 'The proposal is still inside its 24h timelock.'
  },
  10005: {
    name: 'E_CAP_EXCEEDED',
    kind: 'user',
    message: 'Deposit would push the target market past its cap.'
  },
  10006: {
    name: 'E_MARKET_NOT_READ',
    kind: 'user',
    message:
      'A registered market was not synchronized in this transaction. Every market must be synced, Disabled ones included. Re-read the layout — market membership may have changed.'
  },
  10007: {
    name: 'E_REWARDS_NOT_COLLECTED',
    kind: 'user',
    message:
      'An active market reward rule was not harvested in this transaction. Re-read the layout, or check that the RewardFund object for the rule is configured.'
  },
  10008: { name: 'E_RECEIPT_NOT_FOUND', kind: 'user', message: 'No position for this receipt.' },
  10009: {
    name: 'E_VAULT_MISMATCH',
    kind: 'user',
    message: 'The receipt or capability belongs to a different vault.'
  },
  10010: {
    // Classified as an outage, not user error: the caller cannot make a Disabled market
    // accept a deposit. Withdrawals from it still work, so this blocks inflows only.
    name: 'E_MARKET_INVALID',
    kind: 'outage',
    message:
      'Target market is Disabled and cannot receive deposits or allocations. Withdrawals ' +
      'from it are unaffected.'
  },
  10011: {
    name: 'E_PAUSED',
    kind: 'outage',
    message: 'The vault is paused. All user operations are disabled.'
  },
  10012: {
    name: 'E_DEPOSIT_TOO_SMALL',
    kind: 'user',
    message: 'Deposit would mint zero shares. Increase the amount.'
  },
  10013: { name: 'E_OVERFLOW', kind: 'user', message: 'Arithmetic overflow.' },
  10014: { name: 'E_INVALID_PENALTY', kind: 'config', message: 'Penalty exceeds the 30% cap.' },
  10015: {
    name: 'E_ALLOCATOR_CAP_NOT_FOUND',
    kind: 'user',
    message: 'AllocatorCap not registered.'
  },
  10016: { name: 'E_PROPOSAL_NOT_FOUND', kind: 'user', message: 'No such timelock proposal.' },
  10017: {
    name: 'E_MARKET_CONFIG_MISMATCH',
    kind: 'config',
    message:
      'A Storage or incentive object does not match what the vault has recorded for this market. Re-read the layout instead of using configured values.'
  },
  10018: {
    name: 'E_TIMELOCK_EXPIRED',
    kind: 'user',
    message: 'The proposal passed its 7-day grace period.'
  },
  10019: { name: 'E_CURATOR_CAP_NOT_VALID', kind: 'user', message: 'CuratorCap was revoked.' },
  10020: { name: 'E_CURATOR_CAP_NOT_FOUND', kind: 'user', message: 'CuratorCap not registered.' },
  10021: {
    name: 'E_AMOUNT_MISMATCH',
    kind: 'user',
    message:
      'The deposit coin value does not equal the declared amount. Split to exactly the amount.'
  },
  10022: {
    name: 'E_DEFAULT_MARKET_MISMATCH',
    kind: 'user',
    message:
      "The pool argument is not the vault's default market. Deposits route only to the default market; so do withdrawals when fromDefault is set."
  },
  10023: {
    name: 'E_PROPOSAL_ALREADY_EXISTS',
    kind: 'user',
    message: 'A proposal is already pending.'
  },
  10024: { name: 'E_PROPOSAL_NOOP', kind: 'user', message: 'The proposal would change nothing.' },
  10025: { name: 'E_WRONG_PROPOSAL_TYPE', kind: 'user', message: 'Proposal type mismatch.' },
  10026: { name: 'E_RULE_NOT_FOUND', kind: 'config', message: 'No such reward rule.' },
  10027: { name: 'E_RULE_ALREADY_ACTIVE', kind: 'user', message: 'Reward rule is already active.' },
  10028: {
    name: 'E_RULE_ALREADY_INACTIVE',
    kind: 'user',
    message: 'Reward rule is already inactive.'
  },
  10029: {
    name: 'E_REWARD_COIN_TYPE_MISMATCH',
    kind: 'config',
    message: "The RewardCoinType type argument does not match the rule's stored reward coin."
  },
  10030: {
    name: 'E_RULE_INDEX_OUT_OF_BOUNDS',
    kind: 'config',
    message: 'Reward rule index is out of range.'
  },
  10031: {
    name: 'E_FEE_OUT_OF_RANGE',
    kind: 'user',
    message: 'Fee exceeds its cap (20% mgmt / 40% perf).'
  },
  10032: { name: 'E_INVALID_STATUS', kind: 'user', message: 'Unknown market status discriminant.' },
  10033: {
    name: 'E_FEE_UNCHANGED',
    kind: 'user',
    message: 'The fee is already set to this value.'
  },
  10034: { name: 'E_INVALID_AMOUNT', kind: 'user', message: 'Amount must be greater than zero.' },
  10035: {
    name: 'E_MARKET_ALREADY_EXISTS',
    kind: 'user',
    message: 'Market is already registered.'
  },
  10036: {
    name: 'E_INCORRECT_VERSION',
    kind: 'outage',
    message:
      "The vault object's version does not match the deployed package. Distinct from lending_core's 1400 despite both originating in a module named `version`."
  },
  10037: {
    name: 'E_VERSION_UPGRADE_NOT_NEEDED',
    kind: 'user',
    message: 'Vault is already migrated.'
  },
  10038: {
    name: 'E_ACCOUNTING_ERROR',
    kind: 'outage',
    message: 'Vault internal accounting invariant violated.'
  },
  10039: {
    name: 'E_VAULT_CAP_EXCEEDED',
    kind: 'user',
    message: 'Deposit would push the vault past its total cap.'
  },
  10040: {
    name: 'E_SLIPPAGE_EXCEEDED',
    kind: 'transient',
    message:
      'Shares burned exceeded maxShares. Re-simulate the withdrawal to derive a current bound.'
  },
  10041: {
    name: 'E_CANNOT_DISABLE_DEFAULT_MARKET',
    kind: 'user',
    message: 'Cannot disable the default market.'
  },
  10042: {
    name: 'E_WITHDRAW_EXCEEDS_UNDISTRIBUTED',
    kind: 'user',
    message: 'Withdrawal exceeds the undistributed reward balance.'
  }
}

/**
 * Aborts raised by packages the vault calls into. These are the ones most often
 * misattributed: none of them means the caller's request was malformed.
 */
const EXTERNAL_ERRORS: Record<number, ErrorSpec> = {
  1400: {
    name: 'LENDING_INCORRECT_VERSION',
    kind: 'outage',
    message:
      'The vault package is linked against a superseded lending_core. Every depositor operation aborts until the vault package itself is upgraded. Not recoverable client-side: no retry, gas or argument change works around it. Do not display a synced balance or accept deposits while it persists.'
  },
  1502: {
    name: 'ORACLE_INVALID_PRICE',
    kind: 'transient',
    message:
      "The oracle price for the vault's asset is outside its freshness window (30s by default). The withdrawal block must begin with a price update, before the market synchronizations."
  },
  1506: {
    name: 'LENDING_INSUFFICIENT_BALANCE',
    kind: 'liquidity',
    message:
      'The underlying NAVI reserve is too heavily utilized to release the assets. A property of the lending market, not of the vault, and transient. Routing to another market or drawing on the idle balance may succeed.'
  },
  1604: {
    name: 'LENDING_EXCEEDED_DEPOSIT_CAP',
    kind: 'liquidity',
    message:
      "The NAVI reserve's supply ceiling is reached. This bound is shared with every other participant in that reserve — including other vaults on the same market — so it can bind while the vault cap and market cap both have headroom."
  }
}

/**
 * Ordered from most to least specific.
 *
 * The `MoveAbort` pattern is greedy on purpose: a `MoveLocation` contains its own commas,
 * parentheses and numbers (`function: 5, instruction: 42`), and the abort code is the
 * last `, <digits>)` in the expression. A lazy match picks up an instruction offset
 * instead and misclassifies the abort.
 */
const ABORT_CODE_PATTERNS = [
  /MoveAbort\(.*,\s*(\d+)\s*\)/s,
  /\babort_?[cC]ode"?\s*[:=]\s*"?(\d+)/,
  /sub_status:?\s*(?:Some\()?(\d+)/i,
  /abort(?:ed)?\s+(?:with\s+)?(?:code\s+)?(\d+)/i
]

function extractAbortCode(text: string): number | undefined {
  for (const pattern of ABORT_CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return Number(match[1])
    }
  }
  return undefined
}

function extractModule(text: string): string | undefined {
  return text.match(/name:\s*Identifier\("([^"]+)"\)/)?.[1] ?? text.match(/::(\w+)::/)?.[1]
}

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
 * Decodes a Sui abort into a classified vault error.
 *
 * Accepts a thrown error, an error string, or a simulation result's `error` field.
 * Returns `undefined` when the input carries no recognizable abort code — a network
 * failure, for instance, which is not an abort at all.
 */
export function parseVaultError(error: unknown): VaultError | undefined {
  const raw = toText(error)
  if (!raw) return undefined

  const code = extractAbortCode(raw)
  if (code === undefined) return undefined

  const module = extractModule(raw)
  const spec = VAULT_ERRORS[code] ?? EXTERNAL_ERRORS[code]

  if (!spec) {
    return {
      code,
      module,
      name: 'UNKNOWN_ABORT',
      kind: 'unknown',
      message: `Unrecognized abort code ${code}.`,
      raw
    }
  }

  return { code, module, name: spec.name, kind: spec.kind, message: spec.message, raw }
}

/**
 * Wraps an abort in an Error carrying the decoded classification.
 *
 * Passes non-abort inputs through unchanged so that network and transport failures are
 * not mislabeled as protocol conditions.
 */
export class NaviVaultError extends Error {
  readonly code: number
  readonly kind: VaultErrorKind
  readonly abortName: string
  readonly module?: string
  readonly raw: string

  constructor(decoded: VaultError) {
    super(`[${decoded.name} / ${decoded.code}] ${decoded.message}`)
    this.name = 'NaviVaultError'
    this.code = decoded.code
    this.kind = decoded.kind
    this.abortName = decoded.name
    this.module = decoded.module
    this.raw = decoded.raw
  }
}

/** Throws a classified {@link NaviVaultError} when `error` carries an abort code. */
export function throwVaultError(error: unknown): never {
  const decoded = parseVaultError(error)
  if (decoded) throw new NaviVaultError(decoded)
  throw error instanceof Error ? error : new Error(toText(error))
}

/**
 * True when the condition is a protocol-level outage rather than anything the caller
 * did. Callers should suppress balances and block deposits while this holds.
 */
export function isProtocolOutage(error: unknown): boolean {
  return parseVaultError(error)?.kind === 'outage'
}
