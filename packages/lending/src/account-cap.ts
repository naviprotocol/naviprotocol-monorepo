/**
 * Account Capability Management for Lending Protocol
 *
 * This module provides functionality to create account capabilities for the lending protocol.
 * Account capabilities are required to interact with lending pools and manage positions.
 */

import { getConfig, DEFAULT_CACHE_TIME } from './config'
import type { EnvOption } from './types'
import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { parseTxValue } from './utils'

/**
 * Create an account capability transaction in the PTB (Programmable Transaction Block)
 *
 * This function creates a new account capability for the lending protocol.
 * Account capabilities are required to perform lending operations such as
 * borrowing, repaying, and managing collateral positions.
 *
 * @param tx - The transaction block to add the account creation operation to
 * @param options - Optional environment configuration options
 * @returns The transaction call result for creating an account capability
 */
export async function createAccountCapPTB(tx: Transaction, options?: Partial<EnvOption>) {
  const config = await getConfig({
    cacheTime: DEFAULT_CACHE_TIME,
    ...options
  })
  return tx.moveCall({
    target: `${config.package}::lending::create_account`,
    arguments: []
  })
}

export async function getAccountCapOwnerPTB(
  tx: Transaction,
  accountCap: TransactionResult,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    cacheTime: DEFAULT_CACHE_TIME,
    ...options
  })
  return tx.moveCall({
    target: `${config.package}::account::account_owner`,
    arguments: [accountCap]
  })
}
