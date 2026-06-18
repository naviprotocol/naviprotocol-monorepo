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

export type NaviTransactionResponseOptions = {
  showInput?: boolean
  showRawInput?: boolean
  showEffects?: boolean
  showEvents?: boolean
  showObjectChanges?: boolean
  showBalanceChanges?: boolean
  showRawEffects?: boolean
}

export type NaviTransactionExecutionOptions = {
  options?: NaviTransactionResponseOptions
}

export type NaviWalletExecutionClient = {
  core: {
    simulateTransaction?(options: any): Promise<any>
    executeTransaction?(options: any): Promise<any>
  }
}

export type NaviTransactionStatus = {
  status: 'success' | 'failure' | (string & {})
  error?: string
}

export type NaviTransactionEffects = {
  status?: NaviTransactionStatus
  [key: string]: unknown
}

export type NaviTransactionEvent = {
  type: string
  parsedJson?: unknown
  [key: string]: unknown
}

export type NaviBalanceChange = {
  owner?: unknown
  amount: string
  coinType?: string
  [key: string]: unknown
}

export type NaviObjectChange = {
  type?: string
  objectId?: string
  owner?: unknown
  [key: string]: unknown
}

export type NaviTransactionResultBase = {
  digest?: string
  effects?: NaviTransactionEffects
  events: NaviTransactionEvent[]
  balanceChanges: NaviBalanceChange[]
  objectChanges: NaviObjectChange[]
}

export type NaviDryRunTransactionResult = NaviTransactionResultBase & {
  kind: 'dryRun'
}

export type NaviExecuteTransactionResult = NaviTransactionResultBase & {
  kind: 'execute'
}

export type NaviWalletTransactionResult<T extends boolean = false> = T extends true
  ? NaviDryRunTransactionResult
  : NaviExecuteTransactionResult
