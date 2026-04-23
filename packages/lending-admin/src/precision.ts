import BigNumber from 'bignumber.js'
import type { AmountInput, PriceInput, RayRateInput } from './types'

export const RAY_DECIMALS = 27
export const RAY = new BigNumber(10).pow(RAY_DECIMALS)

function parseDecimalInput(value: string, fieldName: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`)
  }

  const parsed = new BigNumber(value)
  if (!parsed.isFinite() || parsed.isNaN()) {
    throw new Error(`${fieldName} must be a valid decimal string`)
  }

  return parsed
}

function parseIntegerInput(value: string, fieldName: string) {
  const parsed = parseDecimalInput(value, fieldName)
  if (!parsed.isInteger()) {
    throw new Error(`${fieldName} must be an integer string`)
  }

  return parsed
}

function assertDecimals(decimals: number, fieldName: string) {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`${fieldName} decimals must be a non-negative integer`)
  }
}

function assertInputUnit<T extends { unit?: string; value?: string }>(
  input: T,
  fieldName: string,
  units: readonly string[]
) {
  if (!input || typeof input !== 'object') {
    throw new Error(`${fieldName} must be an object with value and unit`)
  }

  if (typeof input.value !== 'string') {
    throw new Error(`${fieldName} value must be a string`)
  }

  if (!units.includes(input.unit || '')) {
    throw new Error(`${fieldName} unit must be one of: ${units.join(', ')}`)
  }
}

export function percentToRay(percent: string): string {
  return parseDecimalInput(percent, 'percent')
    .dividedBy(100)
    .multipliedBy(RAY)
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0)
}

export function ratioToRay(ratio: string): string {
  return parseDecimalInput(ratio, 'ratio')
    .multipliedBy(RAY)
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0)
}

export function rayToRatio(ray: string): string {
  return parseIntegerInput(ray, 'ray').dividedBy(RAY).toFixed()
}

export function tokenAmountToAtomic(amount: string, decimals: number): string {
  assertDecimals(decimals, 'token amount')
  return parseDecimalInput(amount, 'token amount')
    .shiftedBy(decimals)
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0)
}

export function atomicToTokenAmount(amount: string, decimals: number): string {
  assertDecimals(decimals, 'atomic amount')
  return parseIntegerInput(amount, 'atomic amount').shiftedBy(-decimals).toFixed()
}

export function assertBoundedRayRateInput(input: RayRateInput, fieldName = 'rate') {
  assertInputUnit(input, fieldName, ['percent', 'ratio', 'ray'])

  if (input.unit === 'percent') {
    const value = parseDecimalInput(input.value, `${fieldName} percent`)
    if (value.lt(0) || value.gt(100)) {
      throw new Error(`${fieldName} percent must be between 0 and 100`)
    }
  }

  if (input.unit === 'ratio') {
    const value = parseDecimalInput(input.value, `${fieldName} ratio`)
    if (value.lt(0) || value.gt(1)) {
      throw new Error(`${fieldName} ratio must be between 0 and 1`)
    }
  }
}

export function encodeRayRate(
  input: RayRateInput,
  options?: { bounded?: boolean; fieldName?: string }
) {
  const fieldName = options?.fieldName || 'rate'
  assertInputUnit(input, fieldName, ['percent', 'ratio', 'ray'])

  if (options?.bounded) {
    assertBoundedRayRateInput(input, fieldName)
  }

  if (input.unit === 'percent') {
    return percentToRay(input.value)
  }

  if (input.unit === 'ratio') {
    return ratioToRay(input.value)
  }

  return parseIntegerInput(input.value, `${fieldName} ray`).toFixed(0)
}

export function encodeAmountInput(input: AmountInput, decimals: number) {
  assertInputUnit(input, 'amount', ['token', 'atomic'])

  if (input.unit === 'token') {
    return tokenAmountToAtomic(input.value, decimals)
  }

  return parseIntegerInput(input.value, 'atomic amount').toFixed(0)
}

export function encodePriceInput(input: PriceInput, fallbackDecimals?: number) {
  assertInputUnit(input, 'price', ['decimal', 'atomic'])

  if (input.unit === 'atomic') {
    return parseIntegerInput(input.value, 'atomic price').toFixed(0)
  }

  const decimals = input.decimals ?? fallbackDecimals
  if (typeof decimals !== 'number') {
    throw new Error('decimal price input requires decimals')
  }

  return tokenAmountToAtomic(input.value, decimals)
}
