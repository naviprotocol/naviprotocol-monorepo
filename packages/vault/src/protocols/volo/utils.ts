import { Vault } from '../../types'

export function checkVault(vault: Vault) {
  if (!vault.volo) {
    throw new Error(`vault ${vault.id} not volo vault`)
  }
}
