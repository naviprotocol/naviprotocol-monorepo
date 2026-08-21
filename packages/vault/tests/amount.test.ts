import { describe, expect, it } from 'vitest'
import { fromBaseUnits, parseBaseUnits, toBaseUnits, VaultSdkError } from '../src'

describe('parseBaseUnits', () => {
  it('takes a smallest-unit integer as is', () => {
    expect(parseBaseUnits('10000000')).toBe(10_000_000n)
    expect(parseBaseUnits('0')).toBe(0n)
    // Past 2^53, where a JSON number would already have rounded.
    expect(parseBaseUnits('11926458395425305')).toBe(11_926_458_395_425_305n)
  })

  it.each(['0.1', '1e6', '-1', '', ' ', 'abc'])('rejects %o', (bad) => {
    expect(() => parseBaseUnits(bad)).toThrow(VaultSdkError)
  })

  it('points a decimal amount at toBaseUnits', () => {
    expect(() => parseBaseUnits('0.1')).toThrow(/smallest/)
  })
})

describe('toBaseUnits', () => {
  it('scales exactly, without floating point', () => {
    expect(toBaseUnits('0.1', 9)).toBe(100_000_000n)
    expect(toBaseUnits('1', 6)).toBe(1_000_000n)
    expect(toBaseUnits('2.5', 6)).toBe(2_500_000n)
    expect(toBaseUnits('0', 9)).toBe(0n)
  })

  it('survives amounts that would lose precision as a Number', () => {
    // 10 SUI at 9 decimals is already 1e10; a large USDC amount overflows the safe
    // integer range once scaled, which is why this never touches `* 10 ** decimals`.
    expect(toBaseUnits('123456789.123456789', 9)).toBe(123_456_789_123_456_789n)
    expect(toBaseUnits('90071992547409.91', 6)).toBe(90_071_992_547_409_910_000n)
  })

  it('rejects more precision than the coin can represent', () => {
    // Truncating would silently lose value, and the caller has a formatting bug.
    expect(() => toBaseUnits('0.1234567', 6)).toThrow(VaultSdkError)
    expect(() => toBaseUnits('0.1234567', 6)).toThrow(/6/)
  })

  it('rejects anything that is not a non-negative decimal', () => {
    for (const bad of ['', '-1', '1e9', 'abc', '1.2.3', '0x1', ' ']) {
      expect(() => toBaseUnits(bad, 9), bad).toThrow(VaultSdkError)
    }
  })

  it('accepts trailing zeros up to the coin precision', () => {
    expect(toBaseUnits('1.000000', 6)).toBe(1_000_000n)
  })
})

describe('fromBaseUnits', () => {
  it('round-trips', () => {
    for (const [human, decimals] of [
      ['0.100000000', 9],
      ['1.000000', 6],
      ['123456789.123456789', 9]
    ] as const) {
      expect(fromBaseUnits(toBaseUnits(human, decimals), decimals)).toBe(human)
    }
  })

  it('formats zero-decimal coins without a point', () => {
    expect(fromBaseUnits(42n, 0)).toBe('42')
  })
})
