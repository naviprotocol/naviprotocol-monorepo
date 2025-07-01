import { SwapOptions, Quote } from './types'
import { getQuoteInternal } from './libs/Aggregator/getQuote'
import { Transaction } from '@mysten/sui/transactions'

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
 * Signs and submits a transaction block using the provided client and keypair.
 * @param txb - The transaction block to sign and submit.
 * @param client - The client object used to sign and execute the transaction block.
 * @param keypair - The keypair used as the signer for the transaction block.
 * @returns A promise that resolves to the result of signing and executing the transaction block.
 */
export async function SignAndSubmitTXB(txb: Transaction, client: any, keypair: any) {
  const result = await client.signAndExecuteTransaction({
    transaction: txb,
    signer: keypair,
    requestType: 'WaitForLocalExecution',
    options: {
      showEffects: true
    }
  })
  return result
}
