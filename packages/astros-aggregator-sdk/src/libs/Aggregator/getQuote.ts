/**
 * Quote Retrieval for DEX Aggregation
 *
 * This module provides functionality to retrieve swap quotes from the aggregator API.
 * It handles API communication, parameter construction, and error handling for
 * getting the best swap routes across multiple DEXes.
 *
 * @module QuoteRetrieval
 */

import axios from 'axios'
import { AggregatorConfig } from './config'
import { Quote, SwapOptions } from '../../types'

/**
 * Retrieves a swap quote between two coins using the aggregator API
 *
 * This function communicates with the aggregator API to find the best swap route
 * between two tokens. It supports various parameters including DEX selection,
 * amount specification, and API authentication.
 *
 * @param fromCoinAddress - The address of the coin to swap from
 * @param toCoinAddress - The address of the coin to swap to
 * @param amountIn - The amount of the fromCoin to swap (number, string, or bigint)
 * @param apiKey - Optional API key for authentication
 * @param swapOptions - Optional swap options including baseUrl, dexList, byAmountIn, and depth
 * @returns Promise<Quote> - A promise that resolves to a Router object containing the swap route details
 * @throws Will throw an error if the API request fails or returns no data
 */
export async function getQuoteInternal(
  fromCoinAddress: string,
  toCoinAddress: string,
  amountIn: number | string | bigint,
  apiKey?: string,
  swapOptions?: SwapOptions
): Promise<Quote> {
  // Set default swap options
  swapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3,
    ...swapOptions
  }

  // Determine the base URL for the API request
  let baseUrl = AggregatorConfig.aggregatorBaseUrl
  if (swapOptions.baseUrl) {
    baseUrl = swapOptions.baseUrl
  }

  // Construct query parameters for the API request
  const params = new URLSearchParams({
    from: fromCoinAddress,
    target: toCoinAddress,
    amount: (typeof amountIn === 'bigint' ? Number(amountIn) : amountIn).toString(),
    by_amount_in:
      swapOptions?.byAmountIn !== undefined ? swapOptions.byAmountIn.toString() : 'true',
    depth: swapOptions?.depth !== undefined ? swapOptions.depth.toString() : '3',
    version: '8'
  }).toString()

  // Construct dex provider string if dexList is provided
  let dexString = ''
  if (swapOptions?.dexList && swapOptions.dexList.length > 0) {
    dexString = swapOptions.dexList.map((dex) => `providers=${dex}`).join('&')
  }

  // Combine parameters and dexString for the full API request
  const fullParams = dexString ? `${params}&${dexString}` : params

  try {
    // Make the API request to fetch the swap route
    const axiosConfig = apiKey ? { headers: { 'x-navi-token': apiKey } } : {}
    const { data } = await axios.get(`${baseUrl}?${fullParams}`, axiosConfig)

    if (!data) {
      throw new Error('No data returned from the API.')
    }

    // Set the from and target properties in the returned data for consistency
    data.data.from = fromCoinAddress
    data.data.target = toCoinAddress

    return data.data as Quote
  } catch (error: any) {
    console.error(
      `Error fetching routes from ${baseUrl} with params ${JSON.stringify(params)}:`,
      error.message
    )
    throw error
  }
}
