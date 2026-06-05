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
