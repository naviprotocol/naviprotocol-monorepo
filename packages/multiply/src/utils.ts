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
export async function inspect(
  client: MultiplySuiClient,
  tx: Transaction,
  inputVersions?: Record<string, string>
) {
  tx.setSenderIfNotSet('0x0')
  const options = { transaction: tx, checksEnabled: false }
  const evidence = { commandResults: true, effects: true, protoJson: true } as const
  const response = inputVersions
    ? await client.core.simulateTransaction({ ...options, include: evidence })
    : await client.core.simulateTransaction({ ...options, include: { commandResults: true } })
  const result = response.Transaction ?? response.FailedTransaction
  check(result?.status.success, 'READ_FAILED', JSON.stringify(result?.status ?? response))
  check(response.commandResults, 'READ_FAILED', 'Missing command results')
  if (inputVersions && result.effects) {
    for (const change of result.effects.changedObjects) {
      if (change.inputState === 'Exists' && change.inputVersion)
        recordReadVersion(inputVersions, change.objectId, change.inputVersion)
    }
    for (const object of result.effects.unchangedConsensusObjects) {
      if (object.kind === 'ReadOnlyRoot' && object.version)
        recordReadVersion(inputVersions, object.objectId, object.version)
    }
    // Sui 2.24 exposes untouched dynamic children in raw gRPC JSON, while
    // older Core clients omit them. Never infer an absent input from an output.
    const raw = response as {
      protoJson?: {
        transaction?: {
          effects?: {
            unchangedLoadedRuntimeObjects?: { objectId?: string; version?: string }[]
          }
        }
      }
    }
    for (const object of raw.protoJson?.transaction?.effects?.unchangedLoadedRuntimeObjects ?? []) {
      if (object.objectId && object.version)
        recordReadVersion(inputVersions, object.objectId, object.version)
    }
  }
  return response.commandResults
}
export function recordReadVersion(versions: Record<string, string>, id: string, version: string) {
  const key = address(id)
  check(
    typeof version === 'string' && /^[1-9][0-9]*$/.test(version),
    'READ_FAILED',
    'Invalid read version'
  )
  check(!versions[key] || versions[key] === version, 'READ_FAILED', 'Conflicting read versions')
  versions[key] = version
}

/** Abort the transaction unless an on-chain `address` value equals `expected`. */
export function assertAddressPTB(
  tx: Transaction,
  actual: TransactionObjectArgument,
  expected: string
) {
  const want = BigInt(address(expected)).toString()
  const value = tx.moveCall({ target: '0x2::address::to_u256', arguments: [actual] })
  // A PTB has no equality assertion: a - b and b - a both exist only when a == b.
  for (const [left, right] of [
    [value, tx.pure.u256(want)],
    [tx.pure.u256(want), value]
  ]) {
    const difference = tx.moveCall({ target: '0x1::u256::checked_sub', arguments: [left, right] })
    tx.moveCall({
      target: '0x1::option::destroy_some',
      typeArguments: ['u256'],
      arguments: [difference]
    })
  }
}

export function minOutputGuard(tx: Transaction, coin: TransactionObjectArgument, amount: string) {
  uint(amount, false)
  // split aborts if insufficient; merge preserves the complete output including surplus.
  const guard = tx.splitCoins(coin, [amount])[0]
  tx.mergeCoins(coin, [guard])
}
