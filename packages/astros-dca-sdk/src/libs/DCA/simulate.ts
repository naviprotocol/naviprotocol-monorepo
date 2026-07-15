import { Transaction } from '@mysten/sui/transactions'
import type { NaviDcaDryRunClient } from './client'
import { normalizeDcaCoreDryRunResult, normalizeDcaDryRunResult } from './transaction-result'

export type NaviDcaDryRunResult = {
  effects?: {
    status?: {
      status: 'success' | 'failure' | (string & {})
      error?: string
    }
    [key: string]: unknown
  }
  events: Array<{
    type: string
    parsedJson?: unknown
    [key: string]: unknown
  }>
  balanceChanges: Array<{
    owner?: unknown
    amount: string
    coinType?: string
    [key: string]: unknown
  }>
  objectChanges: Array<{
    type?: string
    objectId?: string
    owner?: unknown
    [key: string]: unknown
  }>
  raw?: unknown
}

/**
 * Dry-runs a DCA transaction through the Sui v2 JSON-RPC adapter and returns a
 * stable NAVI DTO instead of exposing raw RPC response types.
 */
export async function dryRunDcaTransaction(
  tx: Transaction,
  options: {
    client: NaviDcaDryRunClient
  }
): Promise<NaviDcaDryRunResult> {
  const client = options?.client
  if (!client) {
    throw new Error(
      'dryRunDcaTransaction requires an explicit v2 Core API client; pass legacyJsonRpc only through the deprecated client overload'
    )
  }
  const core = client.core as
    | {
        simulateTransaction?(options: any): Promise<any>
      }
    | undefined
  if (typeof core?.simulateTransaction === 'function') {
    const result = await core.simulateTransaction({
      transaction: tx,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    return normalizeDcaCoreDryRunResult(result)
  }

  const txBytes = await tx.build({
    client: client as any
  })
  if (typeof client.dryRunTransactionBlock !== 'function') {
    throw new Error(
      'DCA simulation requires core.simulateTransaction or an explicit legacy dryRunTransactionBlock client'
    )
  }
  const result = await client.dryRunTransactionBlock({
    transactionBlock: txBytes
  })

  return normalizeDcaDryRunResult(result)
}
