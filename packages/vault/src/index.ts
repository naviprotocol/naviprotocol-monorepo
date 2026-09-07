/**
 * Vault Package - Main Entry Point
 *
 * Unified SDK for NAVI Lending vaults and Volo liquid-staking vaults on Sui.
 * The top-level exports (`getVaults`, `depositPTB`, `withdrawPTB`, `getPositions`, ...)
 * dispatch to the right protocol automatically based on `Vault.source`.
 *
 * Raw base-unit builders and protocol-specific helpers live on the `navi` and
 * `volo` namespaces (`navi.depositPTB`, `volo.getVaultReceipts`, ...).
 *
 * @module Vault
 */

// Export owner-scoped operations: positions, deposit/withdraw PTB builders, rewards, pending requests
export * from './user'
// Export shared type definitions (Vault, VaultPosition, PendingRequest, ...)
export * from './types'

// Export the VaultSdkError class and error codes
export * from './error'

// Move abort decoding: abort code -> constant name, meaning, and VaultSdkError code
export * from './abort'

// Pre-build checks the top-level deposit/withdraw entry points already apply
export * from './preflight'

// Export vault discovery (getVaults, getVault)
export * from './vault'

// NAVI-specific low-level PTB builders, receipt/reward reading, and vault-object parsing
export * as navi from './protocols/navi'

// Volo-specific low-level PTB builders, receipt reading, and pending-request queries
export * as volo from './protocols/volo'
