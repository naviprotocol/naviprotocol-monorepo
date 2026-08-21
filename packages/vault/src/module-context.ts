import type { VaultTransport } from './transport'
import type { CreateVaultSdkOptions, VaultEnv, VaultSuiClient } from './types'

export interface VaultModuleContext {
  client: VaultSuiClient
  env: VaultEnv
  options: Readonly<CreateVaultSdkOptions>
  transport: VaultTransport
}
