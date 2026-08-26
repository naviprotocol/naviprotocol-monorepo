import { CacheOption, EnvOption, Vault, VaultProtocol } from './types'
import { fetchVaultApiData, withCache, withSingleton } from './utils'
import { OPEN_API_URL } from './config'
import { isVaultSdkError, vaultErrors } from './error'

export type GetVaultsOptions = Partial<
  {
    /** Restrict the result to these strategy providers. */
    protocols: VaultProtocol[]
  } & EnvOption &
    CacheOption
>

export type GetVaultOptions = Partial<EnvOption & CacheOption>

/**
 * Lists every vault the NAVI open API knows about.
 *
 * Results are cached for 60s by default and concurrent calls with identical arguments
 * share a single in-flight request.
 *
 * @param options - Optional filters, environment, and cache overrides
 * @param options.protocols - Restrict the result to these strategy providers. Unset returns every vault
 * @param options.env - Target environment. Only `'prod'` is supported
 * @param options.cacheTime - Cache lifetime in milliseconds. Defaults to 60000
 * @param options.disableCache - Bypass the cache and always refetch
 * @returns Promise<Vault[]> - Vaults matching the filters, in API order
 * @throws VaultSdkError with code `API_REQUEST_FAILED` (or `RATE_LIMITED` on HTTP 429) when
 *         the API call fails, or `API_RESPONSE_INVALID` when the payload is not an array
 */
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
  }),
  { defaultCacheTime: 1000 * 60 }
)

/**
 * Resolves a {@link VaultIdentifier} to a {@link Vault}.
 *
 * An already-fetched `Vault` object is returned as-is with no lookup, so callers can pass
 * either form through without branching. A string id is fetched from the NAVI open API and
 * cached for 60s by default; concurrent calls for the same id share one in-flight request.
 *
 * @param id - Vault Sui object id, or an already-fetched `Vault` object to pass through
 * @param options - Optional environment and cache overrides
 * @param options.env - Target environment. Only `'prod'` is supported
 * @param options.cacheTime - Cache lifetime in milliseconds. Defaults to 60000
 * @param options.disableCache - Bypass the cache and always refetch
 * @returns Promise<Vault> - The resolved vault
 * @throws VaultSdkError with code `VAULT_NOT_FOUND` when no vault matches `id`,
 *         `API_REQUEST_FAILED` / `RATE_LIMITED` when the API call fails, or
 *         `API_RESPONSE_INVALID` when the payload is not a vault object
 */
export const getVault = withCache(
  withSingleton(async (id: string | Vault, options?: GetVaultOptions): Promise<Vault> => {
    if (typeof id !== 'string') {
      return id
    }
    const url = `${OPEN_API_URL}/vaults/${encodeURIComponent(id)}`

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
  }),
  { defaultCacheTime: 1000 * 60 }
)
