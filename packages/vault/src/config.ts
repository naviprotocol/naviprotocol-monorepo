/**
 * Vault Configuration Resolution
 *
 * Resolves the package ids, shared objects and vault descriptors the SDK needs.
 *
 * The bundled {@link MAINNET_VAULT_CONFIG} snapshot is the default so the SDK works
 * with no setup, but it is a fallback, not a source of truth: `packageId` changes on
 * every contract upgrade and a stale value silently runs superseded code. Deployments
 * should feed their own configuration through {@link configureVaultSdk}.
 *
 * @module VaultConfig
 */

import { NaviVaultError } from './errors'
import { MAINNET_VAULT_CONFIG } from './snapshot'
import type { VaultConfig, VaultDescriptor, VaultIdentifier, VaultReadOptions } from './types'

/** Move module every vault entrypoint lives in. */
export const VAULT_MODULE = 'navi_vault'

/** Fee rates and market penalties are scaled by this. `1e18` = 100%. */
export const WAD = 1_000_000_000_000_000_000n

/** Reward indices and rates are scaled by this. Rates are per millisecond. */
export const RAY = 1_000_000_000_000_000_000_000_000_000n

/** Largest `u64`. Pass as a withdrawal amount with `fromDefault` to request a full exit. */
export const MAX_U64 = 18_446_744_073_709_551_615n

/**
 * Virtual share offset the contract adds on both sides of the share/asset conversion to
 * make donation-based inflation attacks uneconomic.
 *
 * Consequence worth surfacing in a UI: a holder of 100% of shares cannot drain the vault
 * in one transaction, because redeeming all assets would require burning
 * `total_shares + VIRTUAL_SHARES`. A full exit leaves dust behind. This is by design.
 */
export const VIRTUAL_SHARES = 1_000_000n

/** Sui's all-zero address. `defaultMarket` takes this value when deposits go to idle. */
export const ZERO_ADDRESS = `0x${'0'.repeat(64)}`

/** Seconds in a year, as used by the contract's management fee accrual. */
export const SECONDS_PER_YEAR = 31_536_000n

let overrideConfig: VaultConfig | undefined

/**
 * Installs a configuration that replaces the bundled snapshot for every subsequent call.
 *
 * Pass the values your deployment resolves from chain or from a configuration service.
 * Call with `undefined` to fall back to the snapshot again.
 */
export function configureVaultSdk(config: VaultConfig | undefined): void {
  overrideConfig = config
}

/**
 * Returns the active vault configuration.
 *
 * Async by design: the resolution source is expected to move to a remote endpoint, and
 * an async signature keeps that change from breaking callers.
 */
export async function getVaultConfig(options?: VaultReadOptions): Promise<VaultConfig> {
  return options?.config ?? overrideConfig ?? MAINNET_VAULT_CONFIG
}

function normalizeId(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  return `0x${hex.toLowerCase().padStart(64, '0')}`
}

/** True when the address is Sui's zero address in any padding. */
export function isZeroAddress(value: string | null | undefined): boolean {
  return !value || normalizeId(value) === ZERO_ADDRESS
}

/**
 * Resolves a vault identifier to its descriptor.
 *
 * Accepts a descriptor (returned as-is), a config key such as `USDC_PRIME`, or a vault
 * object id in any padding.
 */
export function resolveVault(identifier: VaultIdentifier, config: VaultConfig): VaultDescriptor {
  if (typeof identifier !== 'string') return identifier

  const byKey = config.vaults.find((vault) => vault.key === identifier)
  if (byKey) return byKey

  const target = normalizeId(identifier)
  const byId = config.vaults.find((vault) => normalizeId(vault.vault) === target)
  if (byId) return byId

  throw new NaviVaultError({
    code: 0,
    name: 'VAULT_NOT_CONFIGURED',
    kind: 'config',
    message: `No vault matches "${identifier}". Known keys: ${config.vaults
      .map((vault) => vault.key)
      .join(', ')}.`,
    raw: identifier
  })
}

/** Resolves a vault identifier against the active configuration. */
export async function getVault(
  identifier: VaultIdentifier,
  options?: VaultReadOptions
): Promise<VaultDescriptor> {
  return resolveVault(identifier, await getVaultConfig(options))
}
