import type { VaultModuleContext } from './module-context'
import type { CreateVaultSdkOptions, VaultEnv, VaultSdk, VaultSuiClient } from './types'
import { createUserModule } from './user'
import { createVaultsModule } from './vaults'

export function createVaultSdk(
  client: VaultSuiClient,
  env: VaultEnv,
  options: CreateVaultSdkOptions = {}
): VaultSdk {
  const context: VaultModuleContext = {
    client,
    env,
    options
  }

  return {
    env,
    client,
    vaults: createVaultsModule(context),
    user: createUserModule(context)
  }
}
