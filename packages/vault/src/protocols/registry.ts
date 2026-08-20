import type { VaultModuleContext } from '../module-context'
import { createNaviLendingPTB } from './navi-lending/ptb'
import type { ProtocolRegistry } from './types'
import { createVoloVaultPTB } from './volo-vault/ptb'

/**
 * Builds the protocol implementations for one SDK instance.
 *
 * A factory rather than a constant because the implementations need the client from
 * `VaultModuleContext`: resolving which receipt to credit, and selecting coin objects to
 * fund a deposit, both read chain state.
 */
export function createProtocolRegistry(context: VaultModuleContext): ProtocolRegistry {
  return {
    'navi-lending': createNaviLendingPTB(context),
    'volo-vault': createVoloVaultPTB(context)
  }
}
