/**
 * Stable, machine-readable codes every {@link VaultSdkError} carries in `.code`.
 * Prefer matching on `code` over parsing `.message`, which is free-form and may change.
 */
export const VAULT_SDK_ERROR_CODES = {
  /** No vault matches the given id. */
  VAULT_NOT_FOUND: 'VAULT_NOT_FOUND',
  /** The vault does not support the requested operation (e.g. calling `navi.*` on a Volo vault). */
  VAULT_UNSUPPORTED: 'VAULT_UNSUPPORTED',
  /** The vault's API/on-chain configuration is missing a field an operation needs. */
  VAULT_CONFIG_INVALID: 'VAULT_CONFIG_INVALID',
  /** Reserved for a future on-chain config version this SDK build cannot parse. */
  UNSUPPORTED_CONFIG_VERSION: 'UNSUPPORTED_CONFIG_VERSION',
  /** A function argument (other than an amount) is missing or malformed. */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  /** An amount/shares value is not a valid positive number for the operation. */
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  /** A {@link PendingRequest} was passed to the wrong cancel entry point (deposit vs withdraw). */
  INVALID_REQUEST_TYPE: 'INVALID_REQUEST_TYPE',
  /** The owner's receipts cannot cover the requested withdrawal. */
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** Reserved for a deposit asset type the target vault does not accept. */
  UNSUPPORTED_DEPOSIT_ASSET: 'UNSUPPORTED_DEPOSIT_ASSET',
  /** The operation is not implemented by this SDK/protocol. */
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
  /** Reserved for looking up a pending request by id that does not exist. */
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  /** An on-chain read (RPC/gRPC call) failed. */
  CHAIN_QUERY_FAILED: 'CHAIN_QUERY_FAILED',
  /** On-chain data was read successfully but has an unexpected shape. */
  CHAIN_DATA_INVALID: 'CHAIN_DATA_INVALID',
  /** The NAVI open API returned a response with an unexpected shape. */
  API_RESPONSE_INVALID: 'API_RESPONSE_INVALID',
  /** The NAVI open API request itself failed (network error or non-2xx status). */
  API_REQUEST_FAILED: 'API_REQUEST_FAILED',
  /** The NAVI open API responded with HTTP 429. A specialization of `API_REQUEST_FAILED`. */
  RATE_LIMITED: 'RATE_LIMITED'
} as const

/** Union of every value in {@link VAULT_SDK_ERROR_CODES}. */
export type VaultSdkErrorCode = (typeof VAULT_SDK_ERROR_CODES)[keyof typeof VAULT_SDK_ERROR_CODES]

/** Structured, JSON-serializable context attached to a {@link VaultSdkError}. */
export type VaultSdkErrorDetails = Readonly<Record<string, unknown>>

export type VaultSdkErrorOptions = {
  /** The underlying error this one wraps, if any (set as `Error.cause`). */
  cause?: unknown
  /** Structured context useful for logging/debugging; see {@link VaultSdkErrorDetails}. */
  details?: VaultSdkErrorDetails
}

/**
 * A stable, machine-readable error returned by the Vault SDK.
 *
 * Every failure this SDK raises is a `VaultSdkError`. Branch on {@link code} rather than
 * parsing {@link Error.message}, which is free-form and may change between releases; use
 * {@link isVaultSdkError} to narrow a caught `unknown`.
 */
export class VaultSdkError extends Error {
  /** Stable, machine-readable failure code. See {@link VAULT_SDK_ERROR_CODES}. */
  readonly code: VaultSdkErrorCode
  /** Structured context about this failure, e.g. the vault id or the offending amount. */
  readonly details?: VaultSdkErrorDetails
  /** The underlying error this one wraps, when it was raised in response to another. */
  override readonly cause?: unknown

  /**
   * @param code - Stable failure code; see {@link VAULT_SDK_ERROR_CODES}
   * @param message - Human-readable description. Not part of the stable contract
   * @param options - Optional cause and structured details
   * @param options.cause - Underlying error to wrap, exposed as both `.cause` and `Error.cause`
   * @param options.details - Structured context for logging and debugging
   */
  constructor(code: VaultSdkErrorCode, message: string, options?: VaultSdkErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VaultSdkError'
    this.code = code
    this.details = options?.details
    this.cause = options?.cause
  }

  /**
   * Serializable form for logs and API responses.
   *
   * Deliberately omits `cause` and the stack, which are not reliably JSON-safe.
   *
   * @returns The error's name, code, message, and details
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

/**
 * Type guard narrowing a caught `unknown` to {@link VaultSdkError}, so `.code` and
 * `.details` can be read safely.
 *
 * @param error - The caught value to test
 * @returns True when `error` is a `VaultSdkError`
 */
export function isVaultSdkError(error: unknown): error is VaultSdkError {
  return error instanceof VaultSdkError
}

/**
 * Positional-argument shorthand behind every {@link vaultErrors} factory.
 *
 * @param code - Stable failure code
 * @param message - Human-readable description
 * @param details - Structured context for logging and debugging
 * @param cause - Underlying error to wrap
 * @returns The constructed error, for the caller to throw
 */
function create(
  code: VaultSdkErrorCode,
  message: string,
  details?: VaultSdkErrorDetails,
  cause?: unknown
) {
  return new VaultSdkError(code, message, { cause, details })
}

/**
 * Centralized Vault SDK error constructors.
 *
 * Each factory builds — but does not throw — a {@link VaultSdkError} with the right code and
 * a consistent message and `details` payload. Routing every failure through here is what
 * keeps `code` and `details` stable across the SDK.
 */
export const vaultErrors = {
  /**
   * No vault matches the given id.
   *
   * @param identifier - The vault id that was looked up
   * @param cause - Underlying error, e.g. the 404 from the API
   */
  vaultNotFound(identifier: string, cause?: unknown) {
    return create('VAULT_NOT_FOUND', `Vault ${identifier} was not found`, { identifier }, cause)
  },

  /**
   * The vault does not support the requested operation, e.g. a `navi.*` builder called on a
   * Volo vault.
   *
   * @param vaultId - The vault the operation was attempted on
   * @param expected - What requires the unmet support, e.g. `'NAVI vault operations'`
   * @param actual - The vault's actual source, when known
   */
  vaultUnsupported(vaultId: string, expected: string, actual?: string) {
    return create('VAULT_UNSUPPORTED', `Vault ${vaultId} is not supported by ${expected}`, {
      vaultId,
      expected,
      actual
    })
  },

  /**
   * The vault's API or on-chain configuration is missing a field the operation needs.
   *
   * @param vaultId - The vault whose configuration is incomplete
   * @param message - What specifically is missing or malformed
   * @param details - Extra context, merged into the error's `details` alongside `vaultId`
   */
  vaultConfigInvalid(vaultId: string, message: string, details?: VaultSdkErrorDetails) {
    return create('VAULT_CONFIG_INVALID', `Vault ${vaultId} configuration is invalid: ${message}`, {
      vaultId,
      ...details
    })
  },

  /**
   * A function argument other than an amount is missing or malformed.
   *
   * @param argument - Name of the offending argument, e.g. `'transaction value'`
   * @param message - Why it was rejected
   * @param details - Extra context, merged into the error's `details` alongside `argument`
   */
  invalidArgument(argument: string, message: string, details?: VaultSdkErrorDetails) {
    return create('INVALID_ARGUMENT', `Invalid ${argument}: ${message}`, { argument, ...details })
  },

  /**
   * An amount or share count is not a valid positive value for the operation.
   *
   * @param message - Why the amount was rejected
   * @param details - Extra context, e.g. the raw input and the parser's own message
   */
  invalidAmount(message: string, details?: VaultSdkErrorDetails) {
    return create('INVALID_AMOUNT', `Invalid amount: ${message}`, details)
  },

  /**
   * A pending request was passed to the wrong cancel entry point.
   *
   * @param expected - Direction the entry point handles, `'deposit'` or `'withdraw'`
   * @param actual - The request's actual `type`
   */
  invalidRequestType(expected: string, actual: string) {
    return create(
      'INVALID_REQUEST_TYPE',
      `Invalid request type: expected ${expected}, received ${actual}`,
      { expected, actual }
    )
  },

  /**
   * The owner's receipts cannot cover the requested withdrawal.
   *
   * @param message - Human-readable description; used as the message verbatim
   * @param details - Context such as the requested and uncovered amounts, and any receipts
   *        excluded from planning
   */
  insufficientBalance(message: string, details?: VaultSdkErrorDetails) {
    return create('INSUFFICIENT_BALANCE', message, details)
  },

  /**
   * An on-chain read failed at the transport level.
   *
   * @param operation - What was being read, phrased to follow "Chain query failed while ..."
   * @param cause - The underlying client/transport error
   * @param details - Context such as the object or table ids involved
   */
  chainQueryFailed(operation: string, cause: unknown, details?: VaultSdkErrorDetails) {
    return create('CHAIN_QUERY_FAILED', `Chain query failed while ${operation}`, details, cause)
  },

  /**
   * On-chain data was read successfully but does not have the expected shape.
   *
   * @param message - What was wrong with the data
   * @param details - Context such as the expected and actual types
   * @param cause - Underlying error, e.g. a BCS parse failure
   */
  chainDataInvalid(message: string, details?: VaultSdkErrorDetails, cause?: unknown) {
    return create('CHAIN_DATA_INVALID', `Invalid chain data: ${message}`, details, cause)
  },

  /**
   * A NAVI open API request failed. Returns code `RATE_LIMITED` for HTTP 429 and
   * `API_REQUEST_FAILED` otherwise.
   *
   * @param url - The request URL
   * @param cause - Underlying network error, or `undefined` for a non-2xx response
   * @param status - HTTP status when the response arrived; omitted for a network failure
   */
  apiRequestFailed(url: string, cause: unknown, status?: number) {
    const code = status === 429 ? 'RATE_LIMITED' : 'API_REQUEST_FAILED'
    const suffix = status === undefined ? '' : ` with status ${status}`
    return create(code, `Vault API request failed${suffix}: ${url}`, { url, status }, cause)
  },

  /**
   * The NAVI open API responded successfully but with an unexpected payload.
   *
   * @param url - The request URL
   * @param message - How the payload deviated, e.g. `'data is not an array'`
   * @param cause - Underlying error, e.g. a JSON parse failure
   */
  apiResponseInvalid(url: string, message: string, cause?: unknown) {
    return create(
      'API_RESPONSE_INVALID',
      `Vault API returned an invalid response for ${url}: ${message}`,
      { url },
      cause
    )
  },

  /**
   * The operation is not implemented by this SDK.
   *
   * @param operation - Name of the unimplemented operation
   */
  operationNotSupported(operation: string) {
    return create(
      'OPERATION_NOT_SUPPORTED',
      `${operation} is not implemented in the Vault SDK framework`,
      { operation }
    )
  }
}

/**
 * Throws {@link vaultErrors.operationNotSupported}. Returns `never`, so it can be used as the
 * body of an unreachable branch without the caller adding its own `throw`.
 *
 * @param operation - Name of the unimplemented operation
 * @throws VaultSdkError with code `OPERATION_NOT_SUPPORTED`, always
 */
export function operationNotSupported(operation: string): never {
  throw vaultErrors.operationNotSupported(operation)
}
