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
    // Validate price values
    if (params.priceRange.minBuyPrice !== null) {
      if (typeof params.priceRange.minBuyPrice !== 'number' || params.priceRange.minBuyPrice < 0) {
        throw new Error('priceRange.minBuyPrice must be a non-negative number or null')
      }
    }
    if (params.priceRange.maxBuyPrice !== null) {
      if (typeof params.priceRange.maxBuyPrice !== 'number' || params.priceRange.maxBuyPrice < 0) {
        throw new Error('priceRange.maxBuyPrice must be a non-negative number or null')
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

/**
 * Convert price to minAmountOut/maxAmountOut
 *
 * Price is expressed as: 1 toCoin = X fromCoin (e.g., 1 USDC = 49.5 NAVX)
 * minAmountOut = amountPerCycle / price (in toCoin atomic units)
 *
 * Formula:
 *   minAmountOut = (amountPerCycle × 10^toDecimals) / (price × 10^fromDecimals)
 *
 * @param amountPerCycle - Amount of fromCoin per execution (atomic units)
 * @param price - Price as 1 toCoin = X fromCoin (human readable, e.g., 49.5)
 * @param fromDecimals - Decimals of fromCoin
 * @param toDecimals - Decimals of toCoin
 * @returns Amount in toCoin atomic units
 */
function priceToAmountOut(
  amountPerCycle: bigint,
  price: number,
  fromDecimals: number,
  toDecimals: number
): bigint {
  // Use high precision to avoid rounding errors
  // Multiply price by 10^18 to preserve decimal precision
  const PRECISION = 18
  const priceBigInt = BigInt(Math.round(price * Math.pow(10, PRECISION)))

  // amountOut = amountPerCycle × 10^toDecimals × 10^PRECISION / (priceBigInt × 10^fromDecimals)
  //           = amountPerCycle × 10^(toDecimals + PRECISION - fromDecimals) / priceBigInt
  const exponent = toDecimals + PRECISION - fromDecimals
  const multiplier = BigInt(Math.pow(10, Math.abs(exponent)))

  if (exponent >= 0) {
    return (amountPerCycle * multiplier) / priceBigInt
  } else {
    return amountPerCycle / (priceBigInt * multiplier)
  }
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
  const U64_MAX = '18446744073709551615'
  let minAmountOut = '0'
  let maxAmountOut = U64_MAX

  if (params.priceRange && decimals) {
    const { fromDecimals, toDecimals } = decimals
    const { minBuyPrice, maxBuyPrice } = params.priceRange

    // Price = how much fromCoin to pay for 1 toCoin
    // Higher price = LESS output (pay more per toCoin)
    // Lower price = MORE output (pay less per toCoin)
    //
    // Mapping:
    //   maxBuyPrice (worst rate, pay most) -> minAmountOut (get least toCoin)
    //   minBuyPrice (best rate, pay least) -> maxAmountOut (get most toCoin)

    // maxBuyPrice -> minAmountOut (highest cost = least output)
    if (maxBuyPrice !== null && maxBuyPrice > 0) {
      const minAmount = priceToAmountOut(amountPerCycle, maxBuyPrice, fromDecimals, toDecimals)
      if (minAmount > 0n) {
        minAmountOut = minAmount.toString()
      }
    }

    // minBuyPrice -> maxAmountOut (lowest cost = most output)
    if (minBuyPrice !== null && minBuyPrice > 0) {
      const maxAmount = priceToAmountOut(amountPerCycle, minBuyPrice, fromDecimals, toDecimals)
      if (maxAmount > 0n) {
        maxAmountOut = maxAmount.toString()
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
