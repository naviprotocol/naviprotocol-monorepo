import {
  NaviAggregatorDryRunClient,
  NaviAggregatorDryRunResult,
  NaviAggregatorExecutionClient,
  NaviAggregatorTransactionResult,
  SwapOptions,
  Quote
} from './types'
import { getQuoteInternal } from './libs/Aggregator/getQuote'
import { Transaction } from '@mysten/sui/transactions'
import { Signer } from '@mysten/sui/cryptography'
import { executeAuction } from 'shio-sdk'
import {
  normalizeAggregatorDryRunResult,
  normalizeAggregatorCoreDryRunResult,
  normalizeAggregatorCoreTransactionResult,
  normalizeAggregatorTransactionResult
} from './transaction-result'
import { fromBase64 } from '@mysten/sui/utils'

function getCore(client: { core?: unknown }) {
  return client.core as
    | {
        simulateTransaction?(options: any): Promise<any>
        executeTransaction?(options: any): Promise<any>
      }
    | undefined
}

/**
 * Retrieves a quote for swapping one coin to another.
 * @param fromCoinAddress - The address of the coin to swap from.
 * @param toCoinAddress - The address of the coin to swap to.
 * @param amountIn - The amount of the fromCoin to swap. Can be a number, string, or bigint.
 * @param apiKey - The API key for authentication.
 * @param swapOptions - Optional. The options for the swap, including baseUrl, dexList, byAmountIn, and depth.
 * @returns A promise that resolves with the quote for the swap.
 */
export async function getQuote(
  fromCoinAddress: string,
  toCoinAddress: string,
  amountIn: number | string | bigint,
  apiKey?: string,
  swapOptions: SwapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3
  }
): Promise<Quote> {
  return getQuoteInternal(fromCoinAddress, toCoinAddress, amountIn, apiKey, swapOptions)
}

/**
 * Signs and executes a transaction.
 * This interface also integrates shio, protect users and protocols from losing value to MEV strategies.
 * @param txb - The transaction to execute.
 * @param signer - The signer object used to sign the transaction block.
 * @param options - Optional. The options for the transaction, including client.
 * @returns A promise that resolves to the result of executing the transaction block.
 */
export async function executeTransaction(
  txb: Transaction,
  signer: Signer,
  options: {
    client: NaviAggregatorExecutionClient
  }
): Promise<NaviAggregatorTransactionResult> {
  const client = options?.client
  if (!client) {
    throw new Error(
      'executeTransaction requires an explicit v2 Core API client; pass legacyJsonRpc only through the deprecated client overload'
    )
  }
  const txBytes = await txb.build({
    client: client as any
  })
  const signResult = await signer.signTransaction(txBytes)
  const signatures = [signResult.signature]

  try {
    await executeAuction(signResult.bytes, signatures)
  } catch (e) {
    console.error(e)
  }

  const core = getCore(client)
  if (typeof core?.executeTransaction === 'function') {
    const result = await core.executeTransaction({
      transaction: fromBase64(signResult.bytes),
      signatures,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    return normalizeAggregatorCoreTransactionResult(result)
  }

  if (typeof client.executeTransactionBlock !== 'function') {
    throw new Error(
      'executeTransaction requires core.executeTransaction or an explicit legacy executeTransactionBlock client'
    )
  }

  const result = await client.executeTransactionBlock({
    transactionBlock: signResult.bytes,
    signature: signatures,
    options: {
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true,
      showObjectChanges: true
    }
  })
  return normalizeAggregatorTransactionResult(result)
}

/**
 * Dry-runs a built aggregator transaction through the Sui v2 JSON-RPC adapter
 * and returns a stable NAVI DTO instead of exposing raw RPC response types.
 *
 * @param txb - The transaction to build and dry-run.
 * @param options - The Sui client used for building and dry-run.
 */
export async function dryRunSwapTransaction(
  txb: Transaction,
  options: {
    client: NaviAggregatorDryRunClient
  }
): Promise<NaviAggregatorDryRunResult> {
  const client = options?.client
  if (!client) {
    throw new Error(
      'dryRunSwapTransaction requires an explicit v2 Core API client; pass legacyJsonRpc only through the deprecated client overload'
    )
  }
  const core = getCore(client)
  if (typeof core?.simulateTransaction === 'function') {
    const result = await core.simulateTransaction({
      transaction: txb,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    return normalizeAggregatorCoreDryRunResult(result)
  }

  const txBytes = await txb.build({
    client: client as any
  })
  if (typeof client.dryRunTransactionBlock !== 'function') {
    throw new Error(
      'dryRunSwapTransaction requires core.simulateTransaction or an explicit legacy dryRunTransactionBlock client'
    )
  }
  const result = await client.dryRunTransactionBlock({
    transactionBlock: txBytes
  })
  return normalizeAggregatorDryRunResult(result)
}
