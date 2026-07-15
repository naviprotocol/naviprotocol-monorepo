import type { NaviDcaDryRunResult } from './simulate'

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}

export function normalizeDcaDryRunResult(result: unknown): NaviDcaDryRunResult {
  const raw = (result ?? {}) as Record<string, unknown>

  return {
    effects: raw.effects as NaviDcaDryRunResult['effects'],
    events: toArray<NaviDcaDryRunResult['events'][number]>(raw.events),
    balanceChanges: toArray<NaviDcaDryRunResult['balanceChanges'][number]>(raw.balanceChanges),
    objectChanges: toArray<NaviDcaDryRunResult['objectChanges'][number]>(raw.objectChanges),
    raw: result
  }
}

function unwrapCoreTransaction(result: unknown) {
  const response = (result ?? {}) as Record<string, any>
  return response.Transaction ?? response.FailedTransaction ?? response
}

export function normalizeDcaCoreDryRunResult(result: unknown): NaviDcaDryRunResult {
  const transaction = unwrapCoreTransaction(result)
  return normalizeDcaDryRunResult({
    effects: transaction.effects,
    events: transaction.events,
    balanceChanges: transaction.balanceChanges,
    objectChanges: transaction.objectChanges,
    raw: result
  })
}
