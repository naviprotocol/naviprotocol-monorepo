import { Transaction } from '@mysten/sui/transactions'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

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
    client: SuiJsonRpcClient
  }
): Promise<NaviDcaDryRunResult> {
  const txBytes = await tx.build({
    client: options.client
  })
  const result = await options.client.dryRunTransactionBlock({
    transactionBlock: txBytes
  })

  return {
    effects: (result.effects ?? undefined) as NaviDcaDryRunResult['effects'],
    events: (result.events ?? []) as NaviDcaDryRunResult['events'],
    balanceChanges: (result.balanceChanges ?? []) as NaviDcaDryRunResult['balanceChanges'],
    objectChanges: (result.objectChanges ?? []) as NaviDcaDryRunResult['objectChanges'],
    raw: result
  }
}
