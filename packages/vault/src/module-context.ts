import type { CreateVaultSdkOptions, VaultEnv, VaultSuiClient } from './types'

export interface VaultModuleContext {
  client: VaultSuiClient
  env: VaultEnv
  options: Readonly<CreateVaultSdkOptions>
}
