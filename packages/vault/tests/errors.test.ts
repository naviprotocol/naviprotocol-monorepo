import { describe, expect, it } from 'vitest'
import { isProtocolOutage, NaviVaultError, parseVaultError } from '../src'

const moveAbort = (module: string, code: number) =>
  `MoveAbort(MoveLocation { module: ModuleId { address: 0x51ceca, name: Identifier("${module}") }, ` +
  `function: 5, instruction: 42, function_name: Some("deposit") }, ${code}) in command 7`

describe('parseVaultError', () => {
  it('decodes a vault abort with its module', () => {
    const decoded = parseVaultError(moveAbort('navi_vault', 10006))
    expect(decoded?.name).toBe('E_MARKET_NOT_READ')
    expect(decoded?.kind).toBe('user')
    expect(decoded?.module).toBe('navi_vault')
    expect(decoded?.code).toBe(10006)
  })

  it('classifies the lending version mismatch as an outage, not user error', () => {
    const decoded = parseVaultError(moveAbort('version', 1400))
    expect(decoded?.name).toBe('LENDING_INCORRECT_VERSION')
    expect(decoded?.kind).toBe('outage')
  })

  it("separates lending's 1400 from the vault's own version error", () => {
    // Both originate in a module named `version`; only the code distinguishes them.
    expect(parseVaultError(moveAbort('version', 1400))?.name).toBe('LENDING_INCORRECT_VERSION')
    expect(parseVaultError(moveAbort('version', 10036))?.name).toBe('E_INCORRECT_VERSION')
  })

  it('classifies reserve conditions as liquidity rather than bad input', () => {
    expect(parseVaultError(moveAbort('validation', 1506))?.kind).toBe('liquidity')
    expect(parseVaultError(moveAbort('validation', 1604))?.kind).toBe('liquidity')
  })

  it("separates the vault's insufficient balance from reserve illiquidity", () => {
    expect(parseVaultError(moveAbort('navi_vault', 10002))?.kind).toBe('user')
    expect(parseVaultError(moveAbort('validation', 1506))?.kind).toBe('liquidity')
  })

  it('marks a stale oracle price as transient', () => {
    expect(parseVaultError(moveAbort('oracle', 1502))?.kind).toBe('transient')
  })

  it('accepts Error instances and plain strings alike', () => {
    expect(parseVaultError(new Error(moveAbort('navi_vault', 10011)))?.name).toBe('E_PAUSED')
    expect(parseVaultError({ error: moveAbort('navi_vault', 10011) })?.name).toBe('E_PAUSED')
  })

  it('reports unknown codes rather than guessing', () => {
    const decoded = parseVaultError(moveAbort('navi_vault', 99999))
    expect(decoded?.kind).toBe('unknown')
    expect(decoded?.code).toBe(99999)
  })

  it('returns undefined for failures that carry no abort code', () => {
    expect(parseVaultError(new Error('fetch failed: ECONNREFUSED'))).toBeUndefined()
    expect(parseVaultError(undefined)).toBeUndefined()
  })
})

describe('isProtocolOutage', () => {
  it.each([
    [1400, true],
    [10011, true],
    [1506, false],
    [10021, false]
  ])('code %i -> %s', (code, expected) => {
    expect(isProtocolOutage(moveAbort('navi_vault', code))).toBe(expected)
  })
})

describe('NaviVaultError', () => {
  it('carries the classification onto the thrown error', () => {
    const decoded = parseVaultError(moveAbort('navi_vault', 10040))!
    const error = new NaviVaultError(decoded)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(10040)
    expect(error.kind).toBe('transient')
    expect(error.abortName).toBe('E_SLIPPAGE_EXCEEDED')
    expect(error.message).toContain('E_SLIPPAGE_EXCEEDED')
  })
})
