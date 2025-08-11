import { SwapOptions, Quote } from './types'
import { getQuoteInternal } from './libs/Aggregator/getQuote'
import { Transaction } from '@mysten/sui/transactions'
import { Signer } from '@mysten/sui/cryptography'
import { SuiClient } from '@mysten/sui/client'
import { executeAuction } from 'shio-sdk'

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
  options?: {
    client?: SuiClient
  }
) {
  const client =
    options?.client ||
    new SuiClient({
      url: 'https://fullnode.mainnet.sui.io'
    })
  const txBytes = await txb.build({
    client
  })
  const signResult = await signer.signTransaction(txBytes)
  const signatures = [signResult.signature]

  try {
    await executeAuction(signResult.bytes, signatures)
  } catch (e) {
    console.error(e)
  }

  const result = await client.executeTransactionBlock({
    transactionBlock: signResult.bytes,
    signature: signatures,
    options: {
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true
    }
  })

  return result
}
