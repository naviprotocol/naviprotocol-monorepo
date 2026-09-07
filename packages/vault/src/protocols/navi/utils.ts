import { LendingConfig, getConfig, DEFAULT_CACHE_TIME } from '@naviprotocol/lending'
import { Vault } from '../../types'
import { vaultErrors } from '../../error'

/**
 * Resolves a market key to its {@link LendingConfig}.
 *
 * Note the asymmetry: only a string key is resolved. Passing an already-resolved
 * `LendingConfig` returns `undefined` rather than echoing it back, so callers must handle a
 * missing result — every call site in this package treats `undefined` as a
 * `VAULT_CONFIG_INVALID` condition.
 *
 * @param market - Market key to resolve. A `LendingConfig` yields `undefined`
 * @returns Promise<LendingConfig | undefined> - The market's config, or `undefined` when
 *          `market` was not a string
 */
export async function getMarketConfig(market: string | LendingConfig) {
  if (typeof market === 'string') {
    return await getConfig({
      market,
      cacheTime: DEFAULT_CACHE_TIME
    })
  }
}

/**
 * Asserts `vault` carries NAVI on-chain config, so the `vault.navi!` accesses in this
 * package's builders are safe.
 *
 * @param vault - The vault to check
 * @returns void - Returns normally when `vault.navi` is present
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when the vault is not a NAVI vault
 */
export function checkVault(vault: Vault) {
  if (!vault.navi) {
    throw vaultErrors.vaultUnsupported(vault.id, 'NAVI vault operations', vault.source)
  }
}
