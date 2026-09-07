import { describe, expect, it } from 'vitest'
import { VAULT_SDK_ERROR_CODES, isVaultSdkError, vaultErrors } from '../../src/error'

describe('VaultSdkError', () => {
  it('carries a stable code, details, and cause, and serializes without the cause', () => {
    const cause = new Error('boom')
    const error = vaultErrors.chainQueryFailed('reading a receipt', cause, { receiptId: '0x1' })
    expect(isVaultSdkError(error)).toBe(true)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('VaultSdkError')
    expect(error.code).toBe(VAULT_SDK_ERROR_CODES.CHAIN_QUERY_FAILED)
    expect(error.details).toEqual({ receiptId: '0x1' })
    expect(error.cause).toBe(cause)
    expect(error.toJSON()).toEqual({
      name: 'VaultSdkError',
      code: 'CHAIN_QUERY_FAILED',
      message: 'Chain query failed while reading a receipt',
      details: { receiptId: '0x1' }
    })
  })

  it('does not recognise plain errors', () => {
    expect(isVaultSdkError(new Error('x'))).toBe(false)
    expect(isVaultSdkError(undefined)).toBe(false)
  })

  it('maps HTTP 429 to RATE_LIMITED and other statuses to API_REQUEST_FAILED', () => {
    expect(vaultErrors.apiRequestFailed('u', undefined, 429).code).toBe('RATE_LIMITED')
    expect(vaultErrors.apiRequestFailed('u', undefined, 500).code).toBe('API_REQUEST_FAILED')
  })
})
