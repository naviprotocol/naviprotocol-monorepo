import type { VaultEndpoints } from './transport'
import type { UserModule } from './user'
import type { VaultsModule } from './vaults'

export type DecimalString = string

export type IntegerString = string

export type HumanAmount = DecimalString

export type VaultEnv = 'prod' | 'test'

export type VaultApp = 'navi' | 'volo' | 'astros'

export type VaultProtocol = 'navi-lending' | 'volo-vault'

/**
 * Sui SDK v2 client.
 *
 * Declared structurally rather than imported from the Sui SDK's client subpath, which the
 * repo's SDK v2 boundary check rejects in published declarations. The concrete clients
 * (`SuiGrpcClient`, `SuiGraphQLClient`) satisfy this shape by exposing `core`.
 *
 * Note a client *has* a Core API rather than being one, so this is the client itself, not
 * `client.core`.
 */
export type VaultSuiClient = {
  core: unknown
}

export interface CreateVaultSdkOptions {
  /**
   * Per-service base URL and headers. Both default to production, so this is only for
   * pointing at a staging deployment or adding auth headers.
   */
  endpoints?: VaultEndpoints
  /** Headers added to every request, before a service's own. */
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
  /** Response cache lifetime in milliseconds. Defaults to 30s. */
  vaultCacheTime?: number
}

export interface VaultSdk {
  readonly env: VaultEnv
  readonly client: VaultSuiClient

  readonly vaults: VaultsModule
  readonly user: UserModule
}
