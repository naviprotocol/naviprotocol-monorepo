import { describe, expect, it } from 'vitest'
import { asVaultSdkError, parseMoveAbort } from '../../src/abort'

const GRPC_JSON =
  '{"command":0,"kind":"MoveAbort","abortCode":"5022","location":{"module":"vault"}}'
const DRY_RUN_TEXT =
  'PTB dry-run failed: MoveAbort in 1st command, abort code: 5013, in ' +
  "'0x7518aa0d::vault::check_version' (instruction 8)"
const JSON_RPC_TEXT =
  'MoveAbort(MoveLocation { module: ModuleId { name: Identifier("user_entry") }, ' +
  'function: 5, instruction: 42 }, 4003) in command 0'

describe('parseMoveAbort', () => {
  it('reads the abort code out of every shape the chain reports it in', () => {
    expect(parseMoveAbort(GRPC_JSON)?.abortCode).toBe(5022)
    expect(parseMoveAbort(new Error(DRY_RUN_TEXT))?.abortCode).toBe(5013)
    // Greedy on purpose: a lazy match takes `function: 5` or `instruction: 42` instead.
    expect(parseMoveAbort(JSON_RPC_TEXT)?.abortCode).toBe(4003)
  })

  it('names the constant and the module the abort came from', () => {
    expect(parseMoveAbort(new Error(DRY_RUN_TEXT))).toMatchObject({
      name: 'ERR_INVALID_VERSION',
      module: 'vault',
      abortedIn: 'vault',
      code: 'UNSUPPORTED_CONFIG_VERSION'
    })
    expect(parseMoveAbort(JSON_RPC_TEXT)).toMatchObject({
      name: 'ERR_WITHDRAW_LOCKED',
      module: 'user_entry',
      code: 'RECEIPT_UNAVAILABLE'
    })
  })

  it('returns undefined rather than guessing', () => {
    // Not an abort at all.
    expect(parseMoveAbort(new Error('fetch failed'))).toBeUndefined()
    // 6001 is three different constants across three modules; decoding it would be a guess.
    expect(parseMoveAbort('abort code: 6001')).toBeUndefined()
    expect(parseMoveAbort(undefined)).toBeUndefined()
  })
})

describe('asVaultSdkError', () => {
  it('maps an abort onto the same code the pre-flight checks raise', () => {
    const error = asVaultSdkError(GRPC_JSON)
    expect(error?.code).toBe('VAULT_NOT_OPEN')
    expect(error?.details).toMatchObject({
      abort: { code: 5022, name: 'ERR_VAULT_NOT_NORMAL', module: 'vault' }
    })
    expect(error?.cause).toBe(GRPC_JSON)
  })

  it('passes through what it cannot decode, so nothing is relabeled', () => {
    expect(asVaultSdkError(new Error('connection reset'))).toBeUndefined()
  })
})
