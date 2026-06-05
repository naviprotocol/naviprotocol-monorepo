import { Transaction } from '@mysten/sui/transactions'
import type { DryRunTransactionBlockResponse } from '@mysten/sui/jsonRpc'
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

import {
  createDcaOrder,
  dryRunDcaTransaction,
  type NaviDcaCoinClient,
  type NaviDcaDryRunClient,
  type NaviDcaDryRunResult,
  TimeUnit
} from '@naviprotocol/astros-dca-sdk'

declare const tx: Transaction
declare const address: string

const jsonRpcClient = new SuiJsonRpcClient({
  network: 'mainnet',
  url: getJsonRpcFullnodeUrl('mainnet')
})
const coinClient: NaviDcaCoinClient = jsonRpcClient
const dryRunClient: NaviDcaDryRunClient = jsonRpcClient

async function acceptsDcaPublicTypes() {
  const orderTx = await createDcaOrder(coinClient, address, {
    fromCoinType: '0x2::sui::SUI',
    toCoinType: '0x2::sui::SUI',
    depositedAmount: '1000',
    frequency: { value: 1, unit: TimeUnit.HOUR },
    totalExecutions: 10
  })
  orderTx.setSender(address)

  const dryRunResult = await dryRunDcaTransaction(tx, { client: dryRunClient })
  const dto: NaviDcaDryRunResult = dryRunResult

  dto.events[0]?.type satisfies string | undefined
  dto.effects?.status?.status satisfies string | undefined

  // @ts-expect-error NAVI v2 DCA dry-run does not expose raw JSON-RPC responses.
  const rawDryRun: DryRunTransactionBlockResponse = dryRunResult

  void rawDryRun
}

void acceptsDcaPublicTypes
