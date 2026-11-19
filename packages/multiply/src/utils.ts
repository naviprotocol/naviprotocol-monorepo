import BigNumber from 'bignumber.js'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import type { MultiplySuiClient } from './types'

export const BN = BigNumber.clone({ DECIMAL_PLACES: 40, ROUNDING_MODE: BigNumber.ROUND_DOWN })
export const RAY = 10n ** 27n
export const U64_MAX = (1n << 64n) - 1n
export class MultiplyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MultiplyError'
  }
}
export function check(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new MultiplyError(code, message)
}
export function uint(value: unknown, allowZero = true): bigint {
  check(
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value),
    'INVALID_ARGUMENT',
    'Amounts must be canonical integer strings'
  )
  const n = BigInt(value)
  check(n <= U64_MAX && (allowZero || n > 0n), 'INVALID_ARGUMENT', 'Amount is outside u64 range')
  return n
}
export function decimal(value: unknown, min = '0'): InstanceType<typeof BN> {
  check(
    typeof value === 'string' && /^\d+(\.\d+)?$/.test(value),
    'INVALID_ARGUMENT',
    'Expected a decimal string'
  )
  const n = new BN(value)
  check(n.isFinite() && n.gte(min), 'INVALID_ARGUMENT', `Expected value >= ${min}`)
  return n
}
export function address(value: string): string {
  check(
    typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value),
    'INVALID_ARGUMENT',
    'Invalid Sui address'
  )
  return normalizeSuiAddress(value)
}
export function coinType(value: string): string {
  try {
    return normalizeStructTag(value)
  } catch {
    throw new MultiplyError('INVALID_ARGUMENT', 'Invalid coin type')
  }
}
export const sameCoin = (a: string, b: string) => coinType(a) === coinType(b)
export const floor = (value: BigNumber.Value) =>
  new BN(value).integerValue(BigNumber.ROUND_FLOOR).toFixed(0)
export const ceil = (value: BigNumber.Value) =>
  new BN(value).integerValue(BigNumber.ROUND_CEIL).toFixed(0)
export const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export async function checksum(value: unknown): Promise<string> {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)])
          )
        : v
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('')
}
/** Read-only VM execution. Failed reads must never become empty positions. */
export async function inspect(client: MultiplySuiClient, tx: Transaction) {
  tx.setSenderIfNotSet('0x0')
  const response = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true }
  })
  const result = response.Transaction ?? response.FailedTransaction
  check(result?.status.success, 'READ_FAILED', JSON.stringify(result?.status ?? response))
  check(response.commandResults, 'READ_FAILED', 'Missing command results')
  return response.commandResults
}
export function minOutputGuard(tx: Transaction, coin: TransactionObjectArgument, amount: string) {
  uint(amount, false)
  // split aborts if insufficient; merge preserves the complete output including surplus.
  const guard = tx.splitCoins(coin, [amount])[0]
  tx.mergeCoins(coin, [guard])
}
