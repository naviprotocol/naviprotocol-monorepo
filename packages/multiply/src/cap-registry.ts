import { bcs } from '@mysten/sui/bcs'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import type { CapRegistryConfig, RegistryKey, Strategy } from './types'
import { address, check, U64_MAX, uint } from './utils'

export const ACCOUNT_CAP_TYPE =
  '0x66c91a8560cd64d73d93dd1ec7b61f3f21ad2f66553dd3d7038ca69255479bb7::account::AccountCap'

export const MAINNET_CAP_REGISTRY: Readonly<CapRegistryConfig> = Object.freeze({
  network: 'sui:mainnet',
  packageId: '0xe98ff1aab2414aa2e60d0561284d011b3c486d47313b51700a2691ad4d37b162',
  objectId: '0x1fb36a5acfcb96b75f0be8869fd6acebbe7586e3e271b81ae4cdcb8ae4ebdd39'
})

export function normalizeCapRegistry(config: CapRegistryConfig): CapRegistryConfig {
  check(config?.network === 'sui:mainnet', 'INVALID_ARGUMENT', 'Unsupported Registry network')
  const packageId = address(config.packageId),
    objectId = address(config.objectId)
  check(
    packageId !== address('0x0') && objectId !== address('0x0'),
    'INVALID_ARGUMENT',
    'Zero Registry address'
  )
  return Object.freeze({ network: config.network, packageId, objectId })
}

export function registryKeyString(key: RegistryKey): string {
  check(key, 'INVALID_ARGUMENT', 'Missing strategy Registry key')
  const id = uint(key.strategyNumericId, false),
    version = uint(key.strategyVersion, false)
  check(
    version < 100000n && id * 100000n + version <= U64_MAX,
    'INVALID_ARGUMENT',
    'Strategy Registry key is outside contract range'
  )
  return `${id}:${version}`
}

export function indexRegistryStrategies(strategies: Strategy[]): Map<string, Strategy> {
  const byKey = new Map<string, Strategy>(),
    ids = new Set<string>()
  for (const strategy of strategies) {
    const key = registryKeyString(strategy.registryKey)
    check(!ids.has(strategy.id), 'INVALID_ARGUMENT', 'Strategy registry contains duplicate ids')
    check(!byKey.has(key), 'INVALID_ARGUMENT', 'Strategy registry contains duplicate numeric keys')
    ids.add(strategy.id)
    byKey.set(key, strategy)
  }
  return byKey
}

export interface RegistryEntry {
  registryKey: RegistryKey
  capId: string
}

/** Decode all rows before using any of them. A malformed response is never an empty registry. */
export function decodeRegistryEntries(values: { bcs: Uint8Array }[]): RegistryEntry[] {
  try {
    check(values?.length === 3, 'READ_FAILED', 'Invalid Registry return values')
    const ids = bcs.vector(bcs.u64()).parse(values[0].bcs)
    const versions = bcs.vector(bcs.u64()).parse(values[1].bcs)
    const caps = bcs.vector(bcs.Address).parse(values[2].bcs)
    check(
      ids.length === versions.length && ids.length === caps.length,
      'READ_FAILED',
      'Registry arrays differ in length'
    )
    const keys = new Set<string>()
    return ids.map((id, i) => {
      const version = versions[i],
        key = `${id}:${version}`
      check(
        BigInt(version) < 100000n &&
          BigInt(id) * 100000n + BigInt(version) <= U64_MAX &&
          !keys.has(key),
        'READ_FAILED',
        'Invalid or duplicate Registry key'
      )
      keys.add(key)
      return {
        registryKey: { strategyNumericId: id, strategyVersion: version },
        capId: address(caps[i])
      }
    })
  } catch {
    check(false, 'READ_FAILED', 'Unable to decode complete Multiply Registry')
  }
}

export function registerCreatedCapPTB(
  tx: Transaction,
  cap: TransactionObjectArgument,
  key: RegistryKey,
  deployment: CapRegistryConfig
) {
  registryKeyString(key)
  const config = normalizeCapRegistry(deployment)
  const capAddress = tx.moveCall({
    target: '0x2::object::id_address',
    typeArguments: [ACCOUNT_CAP_TYPE],
    arguments: [cap]
  })
  tx.moveCall({
    target: `${config.packageId}::multiply_registry::register_mul_for_account_cap`,
    arguments: [
      tx.object(config.objectId),
      capAddress,
      tx.pure.u64(key.strategyNumericId),
      tx.pure.u64(key.strategyVersion)
    ]
  })
}
