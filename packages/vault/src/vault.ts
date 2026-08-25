import { CacheOption, EnvOption, Vault, VaultProtocol } from './types'
import { fetchVaultApiData, withCache, withSingleton } from './utils'
import { OPEN_API_URL } from './config'
import { isVaultSdkError, vaultErrors } from './error'

export type GetVaultsOptions = Partial<
  {
    protocols: VaultProtocol[]
  } & EnvOption &
    CacheOption
>

export type GetVaultOptions = Partial<EnvOption & CacheOption>

export const getVaults = withCache(
  withSingleton(async (options?: GetVaultsOptions): Promise<Vault[]> => {
    const url = `${OPEN_API_URL}/vaults`

    const data = await fetchVaultApiData<Vault[]>(url)
    if (!Array.isArray(data)) {
      throw vaultErrors.apiResponseInvalid(url, 'data is not an array')
    }
    let vaults = data

    if (options?.protocols) {
      vaults = vaults.filter((vault) => {
        return options.protocols?.includes(vault.protocol)
      })
    }

    return vaults
  })
)

export const getVault = withCache(
  withSingleton(async (id: string | Vault, options?: GetVaultOptions): Promise<Vault> => {
    if (typeof id !== 'string') {
      return id
    }
    const url = `${OPEN_API_URL}/vaults/${id}`

    try {
      const vault = await fetchVaultApiData<Vault>(url)
      if (typeof vault !== 'object' || vault === null || typeof vault.id !== 'string') {
        throw vaultErrors.apiResponseInvalid(url, 'data is not a vault object')
      }
      return vault
    } catch (error) {
      if (isVaultSdkError(error) && error.details?.status === 404) {
        throw vaultErrors.vaultNotFound(id, error)
      }
      throw error
    }
  })
)
