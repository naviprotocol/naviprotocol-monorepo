import type { VaultApp, VaultEnv, VaultProtocol } from '../types'

export interface VaultAsset {
  coinType: string
  decimals: number
}

export interface VaultAssets {
  base: VaultAsset
  deposits: VaultAsset[]
}

export interface VoloVaultContractConfig { }

export interface NAVILendingContractConfig { }

export type VaultContractConfig = NAVILendingContractConfig | VoloVaultContractConfig


export interface Vault {
  app: VaultApp
  protocol: VaultProtocol
  env: VaultEnv
  contractConfig: VaultContractConfig
  assets: VaultAssets
  operatorMode: 'instant' | 'eventual'
}


export interface VaultListApiResponse {
  data: Vault[]
}

export interface VaultDetailApiResponse {
  data: Vault | null
}

export type VaultIdentifier = string | Vault

export interface GetVaultOptions {
  disableCache?: boolean
  cacheTime?: number
}

export interface GetVaultsOptions extends GetVaultOptions {
  app: VaultApp[]
}

export interface VaultsModule {
  getVault(vaultId: string, options?: GetVaultOptions): Promise<Vault | null>
  getVaults(options?: GetVaultsOptions): Promise<Vault[]>
}
