import { describe, expect, it } from 'vitest'
import {
  assertBoundedRayRateInput,
  atomicToTokenAmount,
  encodeAmountInput,
  encodePriceInput,
  encodeRayRate,
  percentToRay,
  ratioToRay,
  rayToRatio,
  tokenAmountToAtomic
} from '../src/precision'

describe('ray rate conversion', () => {
  it('converts percent to ray', () => {
    expect(percentToRay('4')).toBe('40000000000000000000000000')
    expect(encodeRayRate({ value: '4', unit: 'percent' })).toBe('40000000000000000000000000')
  })

  it('converts ratio to ray', () => {
    expect(ratioToRay('0.04')).toBe('40000000000000000000000000')
    expect(encodeRayRate({ value: '0.04', unit: 'ratio' })).toBe('40000000000000000000000000')
  })

  it('preserves raw ray values', () => {
    expect(encodeRayRate({ value: '40000000000000000000000000', unit: 'ray' })).toBe(
      '40000000000000000000000000'
    )
  })

  it('rejects ambiguous inputs without a unit', () => {
    expect(() => encodeRayRate({ value: '4' } as never)).toThrow(/unit/)
  })

  it('rejects bounded values outside the valid percent or ratio range', () => {
    expect(() =>
      assertBoundedRayRateInput({ value: '101', unit: 'percent' }, 'reserveFactor')
    ).toThrow(/between 0 and 100/)
    expect(() =>
      assertBoundedRayRateInput({ value: '1.01', unit: 'ratio' }, 'reserveFactor')
    ).toThrow(/between 0 and 1/)
  })

  it('converts ray back to ratio', () => {
    expect(rayToRatio('40000000000000000000000000')).toBe('0.04')
  })
})

describe('amount and price conversion', () => {
  it('converts token amounts to atomic values for different decimals', () => {
    expect(tokenAmountToAtomic('1.5', 9)).toBe('1500000000')
    expect(tokenAmountToAtomic('1.5', 6)).toBe('1500000')
    expect(encodeAmountInput({ value: '1.5', unit: 'token' }, 9)).toBe('1500000000')
  })

  it('preserves atomic amount inputs and converts back to token amounts', () => {
    expect(encodeAmountInput({ value: '1500000000', unit: 'atomic' }, 9)).toBe('1500000000')
    expect(atomicToTokenAmount('1500000000', 9)).toBe('1.5')
  })

  it('encodes price inputs with explicit decimals', () => {
    expect(encodePriceInput({ value: '1.2345', unit: 'decimal', decimals: 6 })).toBe('1234500')
    expect(encodePriceInput({ value: '1234500', unit: 'atomic' }, 6)).toBe('1234500')
  })
})
