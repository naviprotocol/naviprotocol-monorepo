/**
 * Vault Package - Main Entry Point
 *
 * SDK for the NAVI Vault protocol on Sui: single-asset vaults that issue proportional
 * shares and deploy the assets across NAVI lending markets.
 *
 * Two things distinguish this from a conventional SDK, and both are properties of the
 * contract rather than choices made here:
 *
 * - **Deposits and withdrawals are multi-command blocks.** Every registered market must
 *   be synchronized and every active market reward rule harvested in the same
 *   transaction, so a deposit is `M + R + 1` Move calls. The `*PTB` functions emit
 *   individual commands; the `build*Tx` functions assemble whole blocks.
 * - **Prices come from simulation, not from reads.** A market position is a cached
 *   figure refreshed only by an explicit call, and an inactive vault can carry a
 *   month-old snapshot. Every pricing helper simulates a block that synchronizes first.
 *
 * @module Vault
 */

// Configuration, constants and vault resolution
export {
  configureVaultSdk,
  getVault,
  getVaultConfig,
  isZeroAddress,
  resolveVault,
  MAX_U64,
  RAY,
  SECONDS_PER_YEAR,
  VAULT_MODULE,
  VIRTUAL_SHARES,
  WAD,
  ZERO_ADDRESS
} from './config'

// Bundled mainnet snapshot
export { MAINNET_VAULT_CONFIG, SNAPSHOT_GENERATED_AT } from './snapshot'

// Abort decoding and classification
export { isProtocolOutage, NaviVaultError, parseVaultError, throwVaultError } from './errors'
export type { VaultError, VaultErrorKind } from './errors'

// BCS schemas
export * from './bcs'

// Live state discovery
export {
  diffLayoutAgainstConfig,
  findReceipts,
  getVaultLayout,
  selectHarvestableRules
} from './layout'

// Market selection
export {
  findMarket,
  getDefaultMarket,
  marketDepositHeadroom,
  resolveDepositMarket,
  resolveMarket
} from './market'

// Oracle prologue
export { appendOracleProloguePTB, toLendingOptions } from './oracle'

// Low-level PTB command emitters
export {
  appendCollectRewardsPTB,
  appendFreshnessPTB,
  appendSyncMarketsPTB,
  claimRewardPTB,
  createReceiptPTB,
  createTxContext,
  depositPTB,
  getClaimableRewardPTB,
  getTotalAssetsPTB,
  getUserBalancePTB,
  getUserSharesPTB,
  withdrawPTB
} from './ptb'
export type { VaultTxContext } from './ptb'

// Pricing
export { getVaultPositions, getVaultQuote, previewWithdraw, sharePrice } from './quote'
export type { WithdrawPreview } from './quote'

// Transaction builders
export {
  assertOperable,
  buildDepositTx,
  prepareDepositCoin,
  resolveDepositReceipt,
  NEW_POSITION
} from './deposit'
export { buildExitAllTx, buildWithdrawTx, buildWithdrawTxWithPreview } from './withdraw'
export {
  buildClaimRewardTx,
  getRecordedClaimableReward,
  getRewardCoinTypes,
  previewClaimReward
} from './reward'

// Simulation and formatting helpers
export {
  decode,
  decodeCommand,
  decodeOne,
  estimateGas,
  formatUnits,
  isSameAddress,
  normalizeAddress,
  normalizeMoveType,
  simulate,
  tryDecodeCoinBalance,
  wadToPercent,
  SIMULATION_SENDER
} from './utils'
export type { Decoder, GasEstimate, RawCommandReturn } from './utils'

// Types
export * from './types'
