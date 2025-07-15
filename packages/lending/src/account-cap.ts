/**
 * Account Capability Management for Lending Protocol
 *
 * This module provides functionality to create account capabilities for the lending protocol.
 * Account capabilities are required to interact with lending pools and manage positions.
 */

import { getConfig } from './config'
import type { EnvOption } from './types'
import { Transaction } from '@mysten/sui/transactions'

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
    ...options
  })
  return tx.moveCall({
    target: `${config.package}::lending::create_account`,
    arguments: []
  })
}
