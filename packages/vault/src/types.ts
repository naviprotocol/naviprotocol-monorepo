import type { CoreClient } from '@mysten/sui/client'
import type { UserModule } from './user'
import type { VaultsModule } from './vaults'

export type DecimalString = string

export type IntegerString = string

export type HumanAmount = DecimalString

export type VaultEnv = 'prod' | 'test'

export type VaultApp = 'navi' | 'volo' | 'astros'

export type VaultProtocol = 'navi-lending' | 'volo-vault'

export type VaultSuiClient = CoreClient

export interface CreateVaultSdkOptions {
  apiUrl?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
  vaultCacheTime?: number
}

export interface VaultSdk {
  readonly env: VaultEnv
  readonly client: VaultSuiClient

  readonly vaults: VaultsModule
  readonly user: UserModule
}
