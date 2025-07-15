/**
 * Watch Signer Implementation
 *
 * This module provides a watch-only signer implementation for the wallet client.
 * It allows users to view wallet information and transaction details without
 * the ability to sign transactions, useful for read-only operations.
 *
 * @module WatchSigner
 */

import { Signer } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'

/**
 * Options for signing and executing transactions
 */
interface SignAndExecuteOptions {
  /** Transaction to sign and execute */
  transaction: Transaction
  /** Sui client instance */
  client: SuiClient
}

/**
 * Watch-only signer implementation
 *
 * This signer provides read-only access to wallet information without
 * the ability to sign transactions. It's useful for viewing wallet
 * balances, transaction history, and other non-signing operations.
 *
 * Note: This signer cannot actually sign transactions and will return
 * empty signatures or throw errors when signing is attempted.
 */
export class WatchSigner extends Signer {
  /** The wallet address this signer represents */
  private address: string

  /**
   * Creates a new watch-only signer
   *
   * @param address - The wallet address to watch
   */
  constructor(address: string) {
    super()
    this.address = address
  }

  /**
   * Signs transaction bytes (not implemented for watch-only mode)
   *
   * This method is required by the Signer interface but cannot
   * actually sign transactions in watch-only mode.
   *
   * @param bytes - Transaction bytes to sign
   * @returns Promise<Uint8Array> - Empty signature (not valid)
   */
  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array([])
  }

  /**
   * Gets the public key information for this signer
   *
   * Returns a mock public key object that provides the wallet address
   * but cannot be used for actual cryptographic operations.
   *
   * @returns Mock public key object
   */
  getPublicKey(): any {
    return {
      /** Returns the wallet address */
      toSuiAddress: () => this.address,
      /** Returns empty bytes (not a real public key) */
      toBytes: () => new Uint8Array(32),
      /** Returns empty raw bytes (not a real public key) */
      toRawBytes: () => new Uint8Array(32),
      /** Public key flag (0 for mock) */
      flag: 0,
      /** Verification always returns false (not a real public key) */
      verify: async () => false
    }
  }

  /**
   * Gets the key scheme for this signer
   *
   * @returns Key scheme string (ed25519 for compatibility)
   */
  getKeyScheme(): any {
    return 'ed25519'
  }

  /**
   * Signs and executes a transaction (not implemented for watch-only mode)
   *
   * This method is required by the Signer interface but cannot
   * actually sign and execute transactions in watch-only mode.
   *
   * @param options - Sign and execute options
   * @returns Promise<any> - Empty result (not a real transaction result)
   */
  async signAndExecuteTransaction({ transaction, client }: SignAndExecuteOptions): Promise<any> {
    return {} as any
  }
}
