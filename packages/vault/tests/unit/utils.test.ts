import { describe, expect, it } from 'vitest'
import { apportion, parseHumanAmount } from '../../src/utils'
import { isVaultSdkError } from '../../src/error'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return isVaultSdkError(error) ? error.code : `non-sdk-error:${String(error)}`
  }
}

describe('parseHumanAmount', () => {
  it('parses human decimal strings into raw base units', () => {
    expect(parseHumanAmount('1.5', 9)).toBe(1_500_000_000n)
    expect(parseHumanAmount('0.00020497', 8)).toBe(20_497n)
    expect(parseHumanAmount('1', 6)).toBe(1_000_000n)
    expect(parseHumanAmount('123456789.123456789', 9)).toBe(123_456_789_123_456_789n)
  })

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['not a number', 'abc'],
    ['empty', ''],
    ['exponent notation', '1e5'],
    ['too many decimals', '1.0000000001']
  ])('rejects %s (%j) with INVALID_AMOUNT', (_label, input) => {
    expect(codeOf(() => parseHumanAmount(input, 9))).toBe('INVALID_AMOUNT')
  })
})

describe('apportion', () => {
  it('splits in proportion to the weights', () => {
    expect(apportion(1_000n, [30n, 20n])).toEqual([600n, 400n])
    expect(apportion(100n, [1n])).toEqual([100n])
  })

  it('always sums to the total, whatever the rounding', () => {
    for (const weights of [
      [1n, 1n, 1n],
      [7n, 11n, 13n],
      [1n, 999_999n]
    ]) {
      const parts = apportion(10n, weights)
      expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(10n)
    }
  })

  it('yields zeroes when there is nothing to divide or nothing to divide by', () => {
    expect(apportion(0n, [1n, 2n])).toEqual([0n, 0n])
    expect(apportion(100n, [0n, 0n])).toEqual([0n, 0n])
  })
})
