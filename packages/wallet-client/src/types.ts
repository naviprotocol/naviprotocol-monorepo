/**
 * Wallet Client Type Definitions
 *
 * This module contains type definitions used throughout the wallet client,
 * including transaction options, module configurations, and other shared types.
 *
 * @module WalletClientTypes
 */

/**
 * Options for dry-running transactions
 *
 * This type is used to specify whether a transaction should be executed
 * in dry-run mode (simulation only) or actually submitted to the blockchain.
 */
export type DryRunOptions = {
  /** Whether to run the transaction in dry-run mode */
  dryRun: boolean
}
