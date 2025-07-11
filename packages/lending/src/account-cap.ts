import { getConfig } from './config'
import type { EnvOption, TransactionResult } from './types'
import { parseTxVaule } from './utils'
import { Transaction } from '@mysten/sui/transactions'

export async function createAccountCapPTB(tx: Transaction, options?: Partial<EnvOption>) {
  const config = await getConfig({
    ...options
  })
  return tx.moveCall({
    target: `${config.package}::lending::create_account`,
    arguments: []
  })
}
