import { Vault } from '../../types'
import { vaultErrors } from '../../error'

/**
 * Asserts `vault` carries Volo on-chain config, so the `vault.volo!` accesses in this
 * package's builders are safe.
 *
 * @param vault - The vault to check
 * @returns void - Returns normally when `vault.volo` is present
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when the vault is not a Volo vault
 */
export function checkVault(vault: Vault) {
  if (!vault.volo) {
    throw vaultErrors.vaultUnsupported(vault.id, 'Volo vault operations', vault.source)
  }
}
