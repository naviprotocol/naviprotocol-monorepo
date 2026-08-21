import { VaultSdkError } from '../errors'
import type { HumanAmount, IntegerString } from '../types'

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/
const INTEGER_PATTERN = /^\d+$/

/**
 * Validates a smallest-unit amount.
 *
 * The PTB builders take amounts in the coin's smallest unit, the same as
 * `@naviprotocol/lending`, so no conversion happens here — only a check that the caller
 * passed an integer. `toBaseUnits` is exported for callers holding a human amount.
 */
export function parseBaseUnits(amount: IntegerString): bigint {
  const trimmed = amount.trim()
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new VaultSdkError(
      'INVALID_AMOUNT',
      `"${amount}" is not a non-negative integer. Amounts are in the coin's smallest ` +
        `unit — convert a decimal amount with toBaseUnits first.`
    )
  }
  return BigInt(trimmed)
}

/**
 * Converts a human decimal amount to the coin's smallest unit.
 *
 * A convenience for callers, not used on the PTB path. Integer-only arithmetic throughout:
 * a deposit must equal the requested amount exactly or NAVI Lending aborts
 * `E_AMOUNT_MISMATCH`, and `Number` arithmetic on a large amount silently rounds well
 * before that check runs.
 *
 * An input carrying more precision than the coin can represent is rejected rather than
 * truncated: truncating loses value silently, and the caller almost always has a
 * formatting bug worth surfacing.
 */
export function toBaseUnits(amount: HumanAmount, decimals: number): bigint {
  const trimmed = amount.trim()
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new VaultSdkError('INVALID_AMOUNT', `"${amount}" is not a non-negative decimal amount.`)
  }

  const [whole = '0', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new VaultSdkError(
      'INVALID_AMOUNT',
      `"${amount}" carries ${fraction.length} decimal places but the coin has ${decimals}. ` +
        `Round it before calling rather than losing the remainder here.`
    )
  }

  return BigInt(whole + fraction.padEnd(decimals, '0'))
}

/** Formats a smallest-unit amount as a decimal string. Display only. */
export function fromBaseUnits(amount: bigint | IntegerString, decimals: number): HumanAmount {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount)
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals === 0 ? '' : `.${digits.slice(digits.length - decimals)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

export type { DecimalString, HumanAmount, IntegerString } from '../types'
