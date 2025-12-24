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
 * If unit is MONTH, convert to days (30 days per month)
 */
export function normalizeDuration(duration: Duration): { value: number; unit: number } {
  if (duration.unit === TimeUnit.WEEK) {
    return {
      value: duration.value * 7,
      unit: UNIT_DAY
    }
  }
  if (duration.unit === TimeUnit.MONTH) {
    return {
      value: duration.value * 30,
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
 * Convert absolute timestamp to cliff Duration
 *
 * NOTE: Always uses MINUTE unit to preserve maximum precision (1 minute)
 * The contract's minimum precision is 1 minute, so we don't lose any precision this way.
 *
 * @param startTime - Absolute timestamp in milliseconds
 * @returns Duration object for cliff (in MINUTE unit)
 */
export function startTimeToDuration(startTime: number): Duration {
  // startTime is an absolute timestamp in milliseconds
  const nowMs = Date.now()
  const diffMs = startTime - nowMs

  // If target time is in the past or now, return 0 (immediate start)
  if (diffMs <= 0) {
    return { value: 0, unit: TimeUnit.MINUTE }
  }

  // Always use MINUTE unit to preserve maximum precision
  // Contract's minimum precision is 1 minute anyway
  // Round down to avoid starting earlier than intended
  const diffMinutes = Math.floor(diffMs / (60 * 1000))

  return { value: Math.max(1, diffMinutes), unit: TimeUnit.MINUTE }
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

  // Validate startTime (absolute timestamp in ms)
  if (params.startTime !== undefined) {
    if (typeof params.startTime !== 'number' || params.startTime < 0) {
      throw new Error('startTime must be a non-negative timestamp in milliseconds')
    }
  }

  if (params.priceRange) {
    // Validate price values (number)
    if (params.priceRange.minBuyPrice !== null) {
      if (typeof params.priceRange.minBuyPrice !== 'number' || params.priceRange.minBuyPrice < 0) {
        throw new Error('priceRange.minBuyPrice must be a non-negative number or null')
      }
    }
    if (params.priceRange.maxBuyPrice !== null) {
      if (typeof params.priceRange.maxBuyPrice !== 'number' || params.priceRange.maxBuyPrice <= 0) {
        throw new Error('priceRange.maxBuyPrice must be a positive number or null')
      }
    }

    // Validate minBuyPrice <= maxBuyPrice
    if (params.priceRange.minBuyPrice !== null && params.priceRange.maxBuyPrice !== null) {
      if (params.priceRange.minBuyPrice > params.priceRange.maxBuyPrice) {
        throw new Error(
          'priceRange.minBuyPrice must be less than or equal to priceRange.maxBuyPrice'
        )
      }
    }
  }
}

const U64_MAX = 18446744073709551615n

/**
 * Convert buy price to amountOut
 *
 * buyPrice = how many atomic fromCoin to buy 1 whole toCoin
 * amountOut = amountPerCycle * 10^toDecimals / buyPrice
 *
 * @param amountPerCycle - Amount of fromCoin per cycle (in atomic units)
 * @param buyPrice - How many atomic fromCoin per 1 whole toCoin
 * @param toDecimals - Decimals of toCoin
 * @returns amountOut in atomic toCoin units
 */
function buyPriceToAmountOut(amountPerCycle: bigint, buyPrice: bigint, toDecimals: number): bigint {
  if (buyPrice <= 0n) return U64_MAX

  // amountPerCycle is in atomic fromCoin
  // buyPrice is atomic fromCoin per 1 whole toCoin
  // amountOut (whole toCoin) = amountPerCycle / buyPrice
  // amountOut (atomic toCoin) = amountPerCycle * 10^toDecimals / buyPrice
  const multiplier = BigInt(10 ** toDecimals)
  const result = (amountPerCycle * multiplier) / buyPrice

  // Clamp to u64 range
  if (result < 0n) return 0n
  if (result > U64_MAX) return U64_MAX
  return result
}

/**
 * Coin decimals for price conversion
 */
export type CoinDecimals = {
  fromDecimals: number
  toDecimals: number
}

/**
 * Convert DCA parameters to raw on-chain format
 * @param params - DCA order parameters (amounts already in atomic units)
 * @param decimals - Optional coin decimals (required if priceRange is set)
 * @returns Raw parameters ready for on-chain submission
 */
export function convertToRawParams(
  params: DcaOrderParams,
  decimals?: CoinDecimals
): DcaOrderParamsRaw {
  validateDcaOrderParams(params)

  // Normalize duration to frequency + unit (contract format)
  const gap = normalizeDuration(params.frequency)

  // Convert startTime to cliff duration
  // startTime is absolute timestamp (ms), undefined means immediate
  let cliff = { value: 0, unit: UNIT_MINUTE }
  if (params.startTime !== undefined) {
    const cliffDuration = startTimeToDuration(params.startTime)
    cliff = normalizeDuration(cliffDuration)
  }

  const depositedAmount = toAtomicString(params.depositedAmount)
  const amountPerCycle = BigInt(depositedAmount) / BigInt(params.totalExecutions)

  // Convert price range to minAmountOut/maxAmountOut
  // Default: no min (0) and no max (u64::MAX)
  const U64_MAX_STR = U64_MAX.toString()
  let minAmountOut = '0'
  let maxAmountOut = U64_MAX_STR

  // Check if priceRange is set with actual values
  const hasPriceRange =
    params.priceRange &&
    (params.priceRange.minBuyPrice !== null || params.priceRange.maxBuyPrice !== null)

  if (hasPriceRange) {
    // If priceRange is set, decimals MUST be provided
    // This prevents silent failures where price guards don't work
    if (!decimals) {
      throw new Error(
        'decimals is required when priceRange is set. ' +
          'Use createDcaOrder() which handles this automatically, or provide decimals manually.'
      )
    }

    const { toDecimals } = decimals
    const { minBuyPrice, maxBuyPrice } = params.priceRange!

    // buyPrice = how many atomic fromCoin to buy 1 whole toCoin
    // minBuyPrice (lowest price, cheapest) -> maxAmountOut (get most output)
    // maxBuyPrice (highest price, most expensive) -> minAmountOut (get least output)

    if (minBuyPrice !== null && minBuyPrice > 0) {
      const maxAmount = buyPriceToAmountOut(
        amountPerCycle,
        BigInt(Math.floor(minBuyPrice)),
        toDecimals
      )
      if (maxAmount > 0n) maxAmountOut = maxAmount.toString()
    }

    if (maxBuyPrice !== null && maxBuyPrice > 0) {
      const minAmount = buyPriceToAmountOut(
        amountPerCycle,
        BigInt(Math.floor(maxBuyPrice)),
        toDecimals
      )
      if (minAmount > 0n) minAmountOut = minAmount.toString()
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
