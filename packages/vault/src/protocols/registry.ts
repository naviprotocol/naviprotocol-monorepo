import { naviLendingPTB } from './navi-lending/ptb'
import type { ProtocolRegistry } from './types'
import { voloVaultPTB } from './volo-vault/ptb'

export const protocolRegistry = {
  'navi-lending': naviLendingPTB,
  'volo-vault': voloVaultPTB
} satisfies ProtocolRegistry
