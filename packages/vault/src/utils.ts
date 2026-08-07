/**
 * Vault Utilities
 *
 * Read-only simulation and BCS decoding of Move return values.
 *
 * Vault view functions cannot be read from the object's fields: a market position is a
 * cached figure refreshed only by an explicit `sync_market_balance`, and vaults with no
 * recent activity have carried snapshots more than a month old. Every pricing read
 * therefore goes through a simulated block that synchronizes first, which is what these
 * helpers exist to support.
 *
 * ## Why decoding is schema-driven
 *
 * Sui's JSON-RPC `devInspectTransactionBlock` tags each return value with its Move type,
 * and decoding by that tag is the obvious approach. It does not survive the move to gRPC:
 * `simulateTransaction` returns BCS bytes with no type information, so the tag is an
 * empty string on the transport this SDK targets. Every decode here is therefore driven
 * by a schema declared alongside the Move call it belongs to, taken from the contract
 * signature rather than from the response.
 *
 * @module VaultUtils
 */

import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { devInspectTransaction } from '@naviprotocol/lending'
import { throwVaultError } from './errors'
import type { VaultReadOptions } from './types'

/** Raw BCS bytes of one Move call's return values, in declaration order. */
export type RawCommandReturn = Uint8Array[]

/** Decodes one BCS-encoded Move return value. */
export type Decoder<T> = (bytes: Uint8Array) => T

/** Address used as the simulation sender when the caller has none. Needs no funds or key. */
export const SIMULATION_SENDER = `0x${'0'.repeat(63)}1`

/**
 * Decoders for the Move types the vault's view functions return.
 *
 * Integers wider than 32 bits come back as `bigint`: RAY-scaled reward indices always
 * exceed `Number.MAX_SAFE_INTEGER`, and share and asset amounts can.
 */
export const decode = {
  bool: (bytes: Uint8Array) => bcs.Bool.parse(bytes),
  u8: (bytes: Uint8Array) => bcs.U8.parse(bytes),
  u16: (bytes: Uint8Array) => bcs.U16.parse(bytes),
  u32: (bytes: Uint8Array) => bcs.U32.parse(bytes),
  u64: (bytes: Uint8Array) => BigInt(bcs.U64.parse(bytes)),
  u128: (bytes: Uint8Array) => BigInt(bcs.U128.parse(bytes)),
  u256: (bytes: Uint8Array) => BigInt(bcs.U256.parse(bytes)),
  address: (bytes: Uint8Array) => bcs.Address.parse(bytes),
  /** `std::ascii::String` and `std::string::String` share the BCS layout of a string. */
  string: (bytes: Uint8Array) => bcs.string().parse(bytes),
  /**
   * `Coin<T>` is `{ id: UID, balance: Balance<T> }` and both wrappers are single-field,
   * so the layout is a 32-byte address followed by a `u64`.
   */
  coinBalance: (bytes: Uint8Array) =>
    BigInt(bcs.struct('Coin', { id: bcs.Address, balance: bcs.U64 }).parse(bytes).balance)
} as const

/**
 * Evaluates a read-only block and returns each Move call's raw return bytes, in command
 * order. Calls that return nothing yield an empty array.
 *
 * Nothing is written on chain and no signature or funded account is required — only a
 * sender address.
 */
export async function simulate(
  tx: Transaction,
  options?: VaultReadOptions & { sender?: string }
): Promise<RawCommandReturn[]> {
  const sender = options?.sender ?? SIMULATION_SENDER

  let result
  try {
    result = await devInspectTransaction(options?.client, { transaction: tx, sender })
  } catch (error) {
    throwVaultError(error)
  }

  if (result.error) {
    throwVaultError(result.error)
  }

  return (result.results ?? []).map((command) =>
    (command.returnValues ?? []).map(([bytes]) => Uint8Array.from(bytes))
  )
}

/**
 * Decodes one command's return values against a schema.
 *
 * Throws when the command is missing or returned fewer values than the schema expects —
 * a shape mismatch means the contract signature moved, and silently reading `undefined`
 * would surface much later as a nonsensical balance.
 */
export function decodeCommand<const S extends readonly Decoder<unknown>[]>(
  results: RawCommandReturn[],
  commandIndex: number,
  schema: S,
  label: string
): { [K in keyof S]: S[K] extends Decoder<infer T> ? T : never } {
  const command = results[commandIndex]
  if (!command) {
    throw new Error(
      `Simulation returned no result for ${label} (command ${commandIndex} of ${results.length}).`
    )
  }
  if (command.length < schema.length) {
    throw new Error(
      `${label} returned ${command.length} value(s), expected ${schema.length}. ` +
        `The contract signature may have changed.`
    )
  }
  return schema.map((decoder, index) => decoder(command[index]!)) as {
    [K in keyof S]: S[K] extends Decoder<infer T> ? T : never
  }
}

/** Decodes a single-value command. */
export function decodeOne<T>(
  results: RawCommandReturn[],
  commandIndex: number,
  decoder: Decoder<T>,
  label: string
): T {
  return decodeCommand(results, commandIndex, [decoder] as const, label)[0] as T
}

/** Gas a transaction would consume, in MIST. */
export type GasEstimate = {
  computationCost: bigint
  storageCost: bigint
  /** Refunded when storage this transaction frees is reclaimed. */
  storageRebate: bigint
  nonRefundableStorageFee: bigint
  /** `computation + storage - rebate`. What the sender actually pays. */
  netCost: bigint
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value)
  return 0n
}

/**
 * Estimates what a transaction would cost, by simulating it.
 *
 * Worth doing for vault blocks specifically: a deposit or withdrawal is `M + R + 1` Move
 * calls and grows with the vault's market count, so the cost is not a constant an
 * integrator can assume. Opening a new position costs noticeably more than topping up an
 * existing one, because it creates a Receipt object and a ledger entry.
 *
 * Simulated gas is a projection, not a quote — it does not account for execution under
 * contention or for a gas price change between simulation and submission.
 */
export async function estimateGas(
  tx: Transaction,
  options?: VaultReadOptions & { sender?: string }
): Promise<GasEstimate> {
  const sender = options?.sender ?? SIMULATION_SENDER

  let result
  try {
    result = await devInspectTransaction(options?.client, { transaction: tx, sender })
  } catch (error) {
    throwVaultError(error)
  }
  if (result.error) throwVaultError(result.error)

  // The effects type models gasUsed as a fixed struct, but the field arrives as strings
  // over gRPC and as numbers over JSON-RPC, so read it loosely and coerce.
  const used = ((result.effects as unknown as { gasUsed?: Record<string, unknown> })?.gasUsed ??
    {}) as Record<string, unknown>
  const computationCost = toBigInt(used.computationCost)
  const storageCost = toBigInt(used.storageCost)
  const storageRebate = toBigInt(used.storageRebate)

  return {
    computationCost,
    storageCost,
    storageRebate,
    nonRefundableStorageFee: toBigInt(used.nonRefundableStorageFee),
    netCost: computationCost + storageCost - storageRebate
  }
}

/** Reads a `Coin` return value's balance, or `undefined` when it cannot be decoded. */
export function tryDecodeCoinBalance(bytes: Uint8Array | undefined): bigint | undefined {
  if (!bytes) return undefined
  try {
    return decode.coinBalance(bytes)
  } catch {
    return undefined
  }
}

/**
 * Canonicalizes a Move type read out of on-chain state.
 *
 * `type_name::into_string` renders addresses WITHOUT the `0x` prefix, so a coin type
 * read back from the chain looks like `549e8b…::cert::CERT`. That string is not a valid
 * type argument: the gRPC transport rejects it outright with a protobuf `FIELD_INVALID`
 * on `type_arguments`, and the failure surfaces as a transport error rather than a Move
 * abort, so it does not look like a type problem at all. Every type string that comes
 * from a view function must pass through here before being used in a `moveCall`.
 */
export function normalizeMoveType(value: string): string {
  return normalizeStructTag(value.startsWith('0x') ? value : `0x${value}`)
}

/** Normalizes a Sui address to its padded, lowercase 32-byte form. */
export function normalizeAddress(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  return `0x${hex.toLowerCase().padStart(64, '0')}`
}

/** True when two ids refer to the same object regardless of padding or case. */
export function isSameAddress(left: string, right: string): boolean {
  return normalizeAddress(left) === normalizeAddress(right)
}

/**
 * Converts a WAD-scaled rate to a percentage.
 *
 * Lossy — for display only. Never round-trip a fee or penalty through this.
 */
export function wadToPercent(wad: bigint): number {
  const WAD_SCALE = 1_000_000_000_000_000_000n
  // Scale to basis points in integer space before converting, so a large value cannot
  // lose precision on the way through Number.
  return Number((wad * 10_000n) / WAD_SCALE) / 100
}

/** Formats a native-decimals amount as a decimal string. Display only. */
export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals === 0 ? '' : `.${digits.slice(digits.length - decimals)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}
