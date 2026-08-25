export const VAULT_SDK_ERROR_CODES = {
  VAULT_NOT_FOUND: 'VAULT_NOT_FOUND',
  VAULT_UNSUPPORTED: 'VAULT_UNSUPPORTED',
  VAULT_CONFIG_INVALID: 'VAULT_CONFIG_INVALID',
  UNSUPPORTED_CONFIG_VERSION: 'UNSUPPORTED_CONFIG_VERSION',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_REQUEST_TYPE: 'INVALID_REQUEST_TYPE',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  UNSUPPORTED_DEPOSIT_ASSET: 'UNSUPPORTED_DEPOSIT_ASSET',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  CHAIN_QUERY_FAILED: 'CHAIN_QUERY_FAILED',
  CHAIN_DATA_INVALID: 'CHAIN_DATA_INVALID',
  API_RESPONSE_INVALID: 'API_RESPONSE_INVALID',
  API_REQUEST_FAILED: 'API_REQUEST_FAILED',
  RATE_LIMITED: 'RATE_LIMITED'
} as const

export type VaultSdkErrorCode = (typeof VAULT_SDK_ERROR_CODES)[keyof typeof VAULT_SDK_ERROR_CODES]

export type VaultSdkErrorDetails = Readonly<Record<string, unknown>>

export type VaultSdkErrorOptions = {
  cause?: unknown
  details?: VaultSdkErrorDetails
}

/** A stable, machine-readable error returned by the Vault SDK. */
export class VaultSdkError extends Error {
  readonly code: VaultSdkErrorCode
  readonly details?: VaultSdkErrorDetails
  override readonly cause?: unknown

  constructor(code: VaultSdkErrorCode, message: string, options?: VaultSdkErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VaultSdkError'
    this.code = code
    this.details = options?.details
    this.cause = options?.cause
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

export function isVaultSdkError(error: unknown): error is VaultSdkError {
  return error instanceof VaultSdkError
}

function create(
  code: VaultSdkErrorCode,
  message: string,
  details?: VaultSdkErrorDetails,
  cause?: unknown
) {
  return new VaultSdkError(code, message, { cause, details })
}

/** Centralized Vault SDK error constructors. */
export const vaultErrors = {
  vaultNotFound(identifier: string, cause?: unknown) {
    return create('VAULT_NOT_FOUND', `Vault ${identifier} was not found`, { identifier }, cause)
  },

  vaultUnsupported(vaultId: string, expected: string, actual?: string) {
    return create('VAULT_UNSUPPORTED', `Vault ${vaultId} is not supported by ${expected}`, {
      vaultId,
      expected,
      actual
    })
  },

  vaultConfigInvalid(vaultId: string, message: string, details?: VaultSdkErrorDetails) {
    return create('VAULT_CONFIG_INVALID', `Vault ${vaultId} configuration is invalid: ${message}`, {
      vaultId,
      ...details
    })
  },

  invalidArgument(argument: string, message: string, details?: VaultSdkErrorDetails) {
    return create('INVALID_ARGUMENT', `Invalid ${argument}: ${message}`, { argument, ...details })
  },

  invalidAmount(message: string, details?: VaultSdkErrorDetails) {
    return create('INVALID_AMOUNT', `Invalid amount: ${message}`, details)
  },

  invalidRequestType(expected: string, actual: string) {
    return create(
      'INVALID_REQUEST_TYPE',
      `Invalid request type: expected ${expected}, received ${actual}`,
      { expected, actual }
    )
  },

  insufficientBalance(message: string, details?: VaultSdkErrorDetails) {
    return create('INSUFFICIENT_BALANCE', message, details)
  },

  chainQueryFailed(operation: string, cause: unknown, details?: VaultSdkErrorDetails) {
    return create('CHAIN_QUERY_FAILED', `Chain query failed while ${operation}`, details, cause)
  },

  chainDataInvalid(message: string, details?: VaultSdkErrorDetails, cause?: unknown) {
    return create('CHAIN_DATA_INVALID', `Invalid chain data: ${message}`, details, cause)
  },

  apiRequestFailed(url: string, cause: unknown, status?: number) {
    const code = status === 429 ? 'RATE_LIMITED' : 'API_REQUEST_FAILED'
    const suffix = status === undefined ? '' : ` with status ${status}`
    return create(code, `Vault API request failed${suffix}: ${url}`, { url, status }, cause)
  },

  apiResponseInvalid(url: string, message: string, cause?: unknown) {
    return create(
      'API_RESPONSE_INVALID',
      `Vault API returned an invalid response for ${url}: ${message}`,
      { url },
      cause
    )
  },

  operationNotSupported(operation: string) {
    return create(
      'OPERATION_NOT_SUPPORTED',
      `${operation} is not implemented in the Vault SDK framework`,
      { operation }
    )
  }
}

export function operationNotSupported(operation: string): never {
  throw vaultErrors.operationNotSupported(operation)
}
