import type { Vault } from '../../vaults'
import { createUnsupportedProtocolPTB } from '../unsupported'

export const voloVaultPTB = createUnsupportedProtocolPTB<Vault>('volo-vault')
