/**
 * DCA Utility Functions
 *
 * Helper functions for converting between user-friendly and on-chain formats
 */

import {
  Duration,
  TimeUnit,
  PriceRange,
  DcaOrderParams,
  DcaOrderParamsRaw,
  UNIT_SECOND,
  UNIT_MINUTE,
  UNIT_HOUR,
  UNIT_DAY
} from './types'

/**
 * Convert TimeUnit enum to contract's numeric unit
 * Contract uses: 0=second, 1=minute, 2=hour, 3=day
 */
export function timeUnitToNumber(unit: TimeUnit): number {
  switch (unit) {
    case TimeUnit.MINUTE:
      return UNIT_MINUTE
    case TimeUnit.HOUR:
      return UNIT_HOUR
    case TimeUnit.DAY:
      return UNIT_DAY
    case TimeUnit.WEEK:
      return UNIT_DAY
    case TimeUnit.MONTH:
      return UNIT_DAY
    default:
      throw new Error(`Unknown time unit: ${unit}`)
  }
}

/**
 * Normalize duration to contract-supported units
 * If unit is WEEKS, convert to days (7 days per week)
 */
export function normalizeDuration(duration: Duration): { value: number; unit: number } {
  if (duration.unit === TimeUnit.WEEK) {
    return {
      value: duration.value * 7,
      unit: UNIT_DAY
    }
  }
  return {
    value: duration.value,
    unit: timeUnitToNumber(duration.unit)
  }
}

/**
 * Convert duration to milliseconds (for backward compatibility)
 * @deprecated Use frequency + unit instead
 */
export function durationToMs(duration: Duration): number {
  const { value, unit } = duration

  switch (unit) {
    case TimeUnit.MINUTE:
      return value * 60 * 1000
    case TimeUnit.HOUR:
      return value * 60 * 60 * 1000
    case TimeUnit.DAY:
      return value * 24 * 60 * 60 * 1000
    case TimeUnit.WEEK:
      return value * 7 * 24 * 60 * 60 * 1000
    case TimeUnit.MONTH:
      return value * 30 * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown time unit: ${unit}`)
  }
}

/**
 * Convert normalized amount to atomic units
 * @param amount - Normalized amount (e.g., 1.5 for 1.5 SUI)
 * @param decimals - Coin decimals (e.g., 9 for SUI)
 * @returns Atomic units as string (e.g., '1500000000')
 */
export function toAtomicUnits(amount: number, decimals: number): string {
  if (amount < 0) {
    throw new Error('Amount must be non-negative')
  }
  const atomicAmount = Math.floor(amount * Math.pow(10, decimals))
  return atomicAmount.toString()
}

/**
 * Convert atomic units to normalized amount
 * @param atomicAmount - Amount in atomic units (e.g., '1500000000')
 * @param decimals - Coin decimals (e.g., 9 for SUI)
 * @returns Normalized amount (e.g., 1.5)
 */
export function fromAtomicUnits(atomicAmount: string, decimals: number): number {
  const amount = Number(atomicAmount)
  if (isNaN(amount)) {
    throw new Error('Invalid atomic amount')
  }
  return amount / Math.pow(10, decimals)
}

/**
 * Validate DCA order parameters
 */
export function validateDcaOrderParams(params: DcaOrderParams): void {
  if (!params.fromCoinType || !params.toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  if (params.depositedAmount <= 0) {
    throw new Error('depositedAmount must be greater than 0')
  }

  if (params.totalExecutions <= 0 || !Number.isInteger(params.totalExecutions)) {
    throw new Error('totalExecutions must be a positive integer')
  }

  if (params.frequency.value <= 0) {
    throw new Error('frequency value must be greater than 0')
  }

  if (params.cliff && params.cliff.value < 0) {
    throw new Error('cliff value must be non-negative')
  }

  if (params.priceRange) {
    if (params.priceRange.min !== null && params.priceRange.min < 0) {
      throw new Error('priceRange.min must be non-negative or null')
    }
    if (params.priceRange.max !== null && params.priceRange.max < 0) {
      throw new Error('priceRange.max must be non-negative or null')
    }
    if (
      params.priceRange.min !== null &&
      params.priceRange.max !== null &&
      params.priceRange.min > params.priceRange.max
    ) {
      throw new Error('priceRange.min must be less than or equal to priceRange.max')
    }
  }
}

/**
 * Convert user-friendly DCA parameters to raw on-chain format
 * @param params - User-friendly parameters
 * @param fromCoinDecimals - Decimals of the input coin
 * @param toCoinDecimals - Decimals of the output coin
 * @returns Raw parameters ready for on-chain submission
 */
export function convertToRawParams(
  params: DcaOrderParams,
  fromCoinDecimals: number,
  toCoinDecimals: number
): DcaOrderParamsRaw {
  validateDcaOrderParams(params)

  // Normalize duration to frequency + unit (contract format)
  const gap = normalizeDuration(params.frequency)
  const cliff = params.cliff ? normalizeDuration(params.cliff) : { value: 0, unit: UNIT_SECOND }

  const depositedAmount = toAtomicUnits(params.depositedAmount, fromCoinDecimals)

  // Convert price range to atomic units
  // Default: no min (0) and no max (u64::MAX)
  const U64_MAX = '18446744073709551615'
  let minAmountOut = '0'
  let maxAmountOut = U64_MAX

  if (params.priceRange) {
    if (params.priceRange.min !== null && params.priceRange.min > 0) {
      minAmountOut = toAtomicUnits(params.priceRange.min, toCoinDecimals)
    }
    if (params.priceRange.max !== null && params.priceRange.max > 0) {
      maxAmountOut = toAtomicUnits(params.priceRange.max, toCoinDecimals)
    }
  }

  return {
    fromCoinType: params.fromCoinType,
    toCoinType: params.toCoinType,
    depositedAmount,
    orderNum: params.totalExecutions,
    gapFrequency: gap.value,
    gapUnit: gap.unit,
    cliffFrequency: cliff.value,
    cliffUnit: cliff.unit,
    minAmountOut,
    maxAmountOut
  }
}
