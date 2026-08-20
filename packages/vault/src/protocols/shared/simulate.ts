import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { devInspectTransaction } from '@naviprotocol/lending'
import type { NaviSuiClient } from '@naviprotocol/lending'
import { VaultSdkError } from '../../errors'
import type { VaultSuiClient } from '../../types'

/** Address used when simulating. Needs no funds and no key. */
export const SIMULATION_SENDER = `0x${'0'.repeat(63)}1`

/** Decodes one BCS-encoded Move return value. */
export type Decoder<T> = (bytes: Uint8Array) => T

/**
 * Decoders for the return types the vault view functions use.
 *
 * Anything wider than 32 bits comes back as `bigint`: share counts and RAY-scaled
 * figures routinely exceed `Number.MAX_SAFE_INTEGER`.
 */
export const decode = {
  bool: (bytes: Uint8Array) => bcs.Bool.parse(bytes),
  u8: (bytes: Uint8Array) => bcs.U8.parse(bytes),
  u64: (bytes: Uint8Array) => BigInt(bcs.U64.parse(bytes)),
  u256: (bytes: Uint8Array) => BigInt(bcs.U256.parse(bytes)),
  address: (bytes: Uint8Array) => bcs.Address.parse(bytes)
} as const

/**
 * Evaluates a read-only block and returns each Move call's raw return bytes.
 *
 * Decoding is schema-driven rather than driven by the reported Move type. Sui's JSON-RPC
 * `devInspectTransactionBlock` tags each return value with its type, but the gRPC
 * `simulateTransaction` this SDK runs on returns bytes with an empty type string — so the
 * only reliable source of shape is the contract signature, declared at the call site.
 *
 * Nothing is written on chain and no signature is required.
 */
export async function simulate(
  client: VaultSuiClient,
  tx: Transaction,
  sender: string = SIMULATION_SENDER
): Promise<Uint8Array[][]> {
  let result
  try {
    result = await devInspectTransaction(client as NaviSuiClient, { transaction: tx, sender })
  } catch (error) {
    throw new VaultSdkError('CHAIN_QUERY_FAILED', `Simulation failed: ${String(error)}`, {
      cause: error
    })
  }

  if (result.error) {
    throw new VaultSdkError('CHAIN_QUERY_FAILED', `Simulation failed: ${result.error}`)
  }

  return (result.results ?? []).map((command) =>
    (command.returnValues ?? []).map(([bytes]) => Uint8Array.from(bytes))
  )
}

/**
 * Reads one single-value command.
 *
 * Fails loudly when the command is missing: a shape mismatch means the contract signature
 * moved, and reading `undefined` as a balance would surface much later as a wrong amount.
 */
export function decodeOne<T>(
  results: Uint8Array[][],
  commandIndex: number,
  decoder: Decoder<T>,
  label: string
): T {
  const value = results[commandIndex]?.[0]
  if (!value) {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      `Simulation returned no value for ${label} (command ${commandIndex} of ${results.length}).`
    )
  }
  return decoder(value)
}
