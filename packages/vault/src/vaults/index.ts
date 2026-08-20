import { operationNotSupported } from '../errors'
import type { VaultModuleContext } from '../module-context'
import type { GetVaultOptions, GetVaultsOptions, Vault, VaultsModule } from './types'

class DefaultVaultsModule implements VaultsModule {
  async getVault(vaultId: string, options?: GetVaultOptions): Promise<Vault | null> {
    void vaultId
    void options
    return operationNotSupported('vaults.getVault')
  }

  async getVaults(options?: GetVaultsOptions): Promise<Vault[]> {
    void options
    return operationNotSupported('vaults.getVaults')
  }
}

export function createVaultsModule(context: VaultModuleContext): VaultsModule {
  void context
  return new DefaultVaultsModule()
}

export type {
  BaseVault,
  BaseVaultContractConfig,
  GetVaultOptions,
  GetVaultsOptions,
  NAVILendingContractConfig,
  NAVILendingMarket,
  NAVILendingRewardRule,
  NAVILendingRewardRuleType,
  NAVILendingVault,
  ReceiptBasedVaultContractConfig,
  Vault,
  VaultAsset,
  VaultAssets,
  VaultContractConfigMap,
  VaultDetailApiResponse,
  VaultIdentifier,
  VaultListApiResponse,
  VaultOperatorMode,
  VaultsModule,
  VoloVault,
  VoloVaultContractConfig
} from './types'
