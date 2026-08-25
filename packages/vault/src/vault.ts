import { CacheOption, EnvOption, Vault, VaultProtocol } from './types'
import { withCache, withSingleton } from './utils'
import { OPEN_API_URL } from './config'

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

    const res: {
      data: Vault[]
    } = await fetch(url, { headers: {} }).then((res) => res.json())

    let vaults = res.data

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

    const res: {
      data: Vault
    } = await fetch(url, { headers: {} }).then((res) => res.json())

    return res.data
  })
)
