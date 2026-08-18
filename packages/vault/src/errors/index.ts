export type VaultSdkErrorCode =
  | 'VAULT_NOT_FOUND'
  | 'VAULT_UNSUPPORTED'
  | 'VAULT_CONFIG_INVALID'
  | 'UNSUPPORTED_CONFIG_VERSION'
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_BALANCE'
  | 'UNSUPPORTED_DEPOSIT_ASSET'
  | 'OPERATION_NOT_SUPPORTED'
  | 'REQUEST_NOT_FOUND'
  | 'CHAIN_QUERY_FAILED'
  | 'API_RESPONSE_INVALID'
  | 'API_REQUEST_FAILED'

export class VaultSdkError extends Error {
  readonly code: VaultSdkErrorCode
  override readonly cause?: unknown

  constructor(code: VaultSdkErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'VaultSdkError'
    this.code = code
    this.cause = options?.cause
  }
}

export function operationNotSupported(operation: string): never {
  throw new VaultSdkError(
    'OPERATION_NOT_SUPPORTED',
    `${operation} is not implemented in the Vault SDK framework`
  )
}
