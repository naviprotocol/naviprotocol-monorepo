import type {
  NaviDryRunTransactionResult,
  NaviExecuteTransactionResult,
  NaviTransactionResponseOptions
} from './types'

export const defaultTransactionResponseOptions: NaviTransactionResponseOptions = {
  showEffects: true,
  showEvents: true,
  showBalanceChanges: true,
  showObjectChanges: true
}

export function mergeTransactionResponseOptions(
  options?: NaviTransactionResponseOptions
): NaviTransactionResponseOptions {
  return {
    ...defaultTransactionResponseOptions,
    ...options
  }
}

export function normalizeTransactionResult(
  kind: 'dryRun',
  result: unknown
): NaviDryRunTransactionResult
export function normalizeTransactionResult(
  kind: 'execute',
  result: unknown
): NaviExecuteTransactionResult
export function normalizeTransactionResult(kind: 'dryRun' | 'execute', result: unknown) {
  const raw = (result ?? {}) as Record<string, unknown>

  return {
    ...raw,
    kind,
    events: Array.isArray(raw.events) ? raw.events : [],
    balanceChanges: Array.isArray(raw.balanceChanges) ? raw.balanceChanges : [],
    objectChanges: Array.isArray(raw.objectChanges) ? raw.objectChanges : []
  }
}
