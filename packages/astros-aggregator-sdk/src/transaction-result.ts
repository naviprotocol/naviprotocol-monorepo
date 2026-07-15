import type { NaviAggregatorDryRunResult, NaviAggregatorTransactionResult } from './types'

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}

export function normalizeAggregatorTransactionResult(
  result: unknown
): NaviAggregatorTransactionResult {
  const raw = (result ?? {}) as Record<string, unknown>

  return {
    ...raw,
    digest: typeof raw.digest === 'string' ? raw.digest : undefined,
    effects: raw.effects as NaviAggregatorTransactionResult['effects'],
    events: toArray<NaviAggregatorTransactionResult['events'][number]>(raw.events),
    balanceChanges: toArray<NaviAggregatorTransactionResult['balanceChanges'][number]>(
      raw.balanceChanges
    ),
    objectChanges: toArray<NaviAggregatorTransactionResult['objectChanges'][number]>(
      raw.objectChanges
    ),
    raw: result
  }
}

export function normalizeAggregatorDryRunResult(result: unknown): NaviAggregatorDryRunResult {
  const raw = (result ?? {}) as Record<string, unknown>

  return {
    effects: raw.effects as NaviAggregatorDryRunResult['effects'],
    events: toArray<NaviAggregatorDryRunResult['events'][number]>(raw.events),
    balanceChanges: toArray<NaviAggregatorDryRunResult['balanceChanges'][number]>(
      raw.balanceChanges
    ),
    objectChanges: toArray<NaviAggregatorDryRunResult['objectChanges'][number]>(raw.objectChanges),
    raw: result
  }
}

function unwrapCoreTransaction(result: unknown) {
  const response = (result ?? {}) as Record<string, any>
  return response.Transaction ?? response.FailedTransaction ?? response
}

export function normalizeAggregatorCoreTransactionResult(
  result: unknown
): NaviAggregatorTransactionResult {
  const transaction = unwrapCoreTransaction(result)
  return normalizeAggregatorTransactionResult({
    digest: transaction.digest,
    effects: transaction.effects,
    events: transaction.events,
    balanceChanges: transaction.balanceChanges,
    objectChanges: transaction.objectChanges,
    raw: result
  })
}

export function normalizeAggregatorCoreDryRunResult(result: unknown): NaviAggregatorDryRunResult {
  const transaction = unwrapCoreTransaction(result)
  return normalizeAggregatorDryRunResult({
    effects: transaction.effects,
    events: transaction.events,
    balanceChanges: transaction.balanceChanges,
    objectChanges: transaction.objectChanges,
    raw: result
  })
}
