import type {
  NaviDryRunTransactionResult,
  NaviExecuteTransactionResult,
  NaviTransactionEffects,
  NaviTransactionEvent,
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
export function normalizeTransactionResult(
  kind: 'dryRun' | 'execute',
  result: unknown
): NaviDryRunTransactionResult | NaviExecuteTransactionResult {
  const source = (result ?? {}) as Record<string, unknown>
  const raw = unwrapTransactionResult(source)
  const effects = normalizeEffects(raw)

  return {
    ...raw,
    kind,
    effects,
    events: normalizeEvents(raw.events),
    balanceChanges: Array.isArray(raw.balanceChanges) ? raw.balanceChanges : [],
    objectChanges: Array.isArray(raw.objectChanges) ? raw.objectChanges : []
  }
}

function unwrapTransactionResult(result: Record<string, unknown>) {
  const transaction = result.Transaction
  if (isRecord(transaction)) {
    return transaction
  }

  const failedTransaction = result.FailedTransaction
  if (isRecord(failedTransaction)) {
    return failedTransaction
  }

  return result
}

function normalizeEffects(raw: Record<string, unknown>): NaviTransactionEffects | undefined {
  if (isRecord(raw.effects)) {
    return raw.effects as NaviTransactionEffects
  }

  if (isRecord(raw.status)) {
    return {
      status: raw.status as NaviTransactionEffects['status']
    }
  }

  return undefined
}

function normalizeEvents(events: unknown): NaviTransactionEvent[] {
  if (!Array.isArray(events)) {
    return []
  }

  return events.map((event) => {
    if (!isRecord(event) || event.parsedJson !== undefined || event.json === undefined) {
      return event
    }

    return {
      ...event,
      parsedJson: event.json
    }
  }) as NaviTransactionEvent[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
