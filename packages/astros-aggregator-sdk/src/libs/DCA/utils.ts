/**
 * DCA Utility Functions
 *
 * Helper functions for converting between user-friendly and on-chain formats
 */

import {
  Duration,
  TimeUnit,
  DcaOrderParams,
  DcaOrderParamsRaw,
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
 * Convert amount to string format for Move contract
 * @param amount - Amount in atomic units (string, number, or bigint)
 * @returns Amount as string
 */
export function toAtomicString(amount: string | number | bigint): string {
  if (typeof amount === 'bigint') {
    return amount.toString()
  }
  if (typeof amount === 'string') {
    // Validate it's a valid number string
    const num = BigInt(amount)
    return num.toString()
  }
  // Convert number to integer string
  return Math.floor(amount).toString()
}

/**
 * Validate DCA order parameters
 */
export function validateDcaOrderParams(params: DcaOrderParams): void {
  if (!params.fromCoinType || !params.toCoinType) {
    throw new Error('fromCoinType and toCoinType are required')
  }

  // Validate depositedAmount is a valid positive number/string/bigint
  try {
    const amount = BigInt(toAtomicString(params.depositedAmount))
    if (amount <= 0n) {
      throw new Error('depositedAmount must be greater than 0')
    }
  } catch (e) {
    throw new Error('depositedAmount must be a valid positive number in atomic units')
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
    if (params.priceRange.min !== null) {
      try {
        const min = BigInt(toAtomicString(params.priceRange.min))
        if (min < 0n) {
          throw new Error('priceRange.min must be non-negative or null')
        }
      } catch (e) {
        throw new Error('priceRange.min must be a valid number in atomic units or null')
      }
    }
    if (params.priceRange.max !== null) {
      try {
        const max = BigInt(toAtomicString(params.priceRange.max))
        if (max < 0n) {
          throw new Error('priceRange.max must be non-negative or null')
        }
      } catch (e) {
        throw new Error('priceRange.max must be a valid number in atomic units or null')
      }
    }
    if (params.priceRange.min !== null && params.priceRange.max !== null) {
      const min = BigInt(toAtomicString(params.priceRange.min))
      const max = BigInt(toAtomicString(params.priceRange.max))
      if (min > max) {
        throw new Error('priceRange.min must be less than or equal to priceRange.max')
      }
    }
  }
}

/**
 * Convert DCA parameters to raw on-chain format
 * @param params - DCA order parameters (amounts already in atomic units)
 * @returns Raw parameters ready for on-chain submission
 */
export function convertToRawParams(params: DcaOrderParams): DcaOrderParamsRaw {
  validateDcaOrderParams(params)

  // Normalize duration to frequency + unit (contract format)
  const gap = normalizeDuration(params.frequency)
  const cliff = params.cliff ? normalizeDuration(params.cliff) : { value: 0, unit: UNIT_MINUTE }

  const depositedAmount = toAtomicString(params.depositedAmount)

  // Convert price range to string format
  // Default: no min (0) and no max (u64::MAX)
  const U64_MAX = '18446744073709551615'
  let minAmountOut = '0'
  let maxAmountOut = U64_MAX

  if (params.priceRange) {
    if (params.priceRange.min !== null) {
      const minVal = BigInt(toAtomicString(params.priceRange.min))
      if (minVal > 0n) {
        minAmountOut = minVal.toString()
      }
    }
    if (params.priceRange.max !== null) {
      const maxVal = BigInt(toAtomicString(params.priceRange.max))
      if (maxVal > 0n) {
        maxAmountOut = maxVal.toString()
      }
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
