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
import type { PublicKey, SignatureScheme, SignatureWithBytes } from '@mysten/sui/cryptography'
import type { NaviWalletExecutionClient } from './types'

/**
 * Minimal mock public key used by watch-only / web signers. It exposes the
 * address but cannot perform real cryptography; typed as `PublicKey` for the
 * `Signer` contract via a cast since it is intentionally incomplete.
 */
function createMockPublicKey(address: string): PublicKey {
  return {
    toSuiAddress: () => address,
    toBytes: () => new Uint8Array(32),
    toRawBytes: () => new Uint8Array(32),
    flag: () => 0,
    verify: async () => false
  } as unknown as PublicKey
}

/**
 * Options for signing and executing transactions
 */
interface SignAndExecuteOptions {
  /** Transaction to sign and execute */
  transaction: Transaction
  /** Sui client instance */
  client: NaviWalletExecutionClient
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
  override async sign(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(0))
  }

  /**
   * Gets the public key information for this signer
   *
   * Returns a mock public key object that provides the wallet address
   * but cannot be used for actual cryptographic operations.
   */
  getPublicKey(): PublicKey {
    return createMockPublicKey(this.address)
  }

  /**
   * Gets the key scheme for this signer
   *
   * @returns Key scheme (ed25519 for compatibility)
   */
  getKeyScheme(): SignatureScheme {
    return 'ED25519'
  }

  /**
   * Signs and executes a transaction (not implemented for watch-only mode)
   *
   * This method is required by the Signer interface but cannot
   * actually sign and execute transactions in watch-only mode.
   */
  override async signAndExecuteTransaction(
    options: SignAndExecuteOptions
  ): ReturnType<Signer['signAndExecuteTransaction']> {
    return {} as Awaited<ReturnType<Signer['signAndExecuteTransaction']>>
  }
}

/**
 * Web signer implementation
 *
 * For use in browser environments
 */
export abstract class WebSigner extends Signer {
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
  override async sign(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(0))
  }

  /**
   * Gets the public key information for this signer
   *
   * Returns a mock public key object that provides the wallet address
   * but cannot be used for actual cryptographic operations.
   */
  getPublicKey(): PublicKey {
    return createMockPublicKey(this.address)
  }

  /**
   * Gets the key scheme for this signer
   *
   * @returns Key scheme (ed25519 for compatibility)
   */
  getKeyScheme(): SignatureScheme {
    return 'ED25519'
  }

  abstract signPersonalMessage(bytes: Uint8Array): Promise<SignatureWithBytes>

  abstract signTransaction(bytes: Uint8Array): Promise<SignatureWithBytes>
}
