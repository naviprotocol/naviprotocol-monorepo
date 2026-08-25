import { Vault } from '../../types'
import { vaultErrors } from '../../error'

export function checkVault(vault: Vault) {
  if (!vault.volo) {
    throw vaultErrors.vaultUnsupported(vault.id, 'Volo vault operations', vault.source)
  }
}
