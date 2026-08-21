import type { VaultModuleContext } from './module-context'
import { createVaultTransport } from './transport'
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
    options,
    transport: createVaultTransport(options)
  }

  return {
    env,
    client,
    vaults: createVaultsModule(context),
    user: createUserModule(context)
  }
}
