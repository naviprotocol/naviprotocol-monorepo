/**
 * Swap Transaction Building
 *
 * This module provides functionality for building swap transactions using the
 * Astros aggregator. It handles coin management, quote processing, service fees,
 * and transaction construction for DEX swaps.
 *
 * @module SwapTransactionBuilding
 */

import { AggregatorConfig } from './config'
import { Quote, SwapOptions } from '../../types'
import { returnMergedCoins } from '../PTB/commonFunctions'
import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'
import { getQuoteInternal as getQuote } from './getQuote'
import { generateRefId } from './utils'
import { handleServiceFee, emitServiceFeeEvent } from './serviceFee'
import { buildSwapWithoutServiceFee } from './buildSwapWithoutServiceFee'

/**
 * Gets coin objects for a specific address and coin type
 *
 * @param client - Sui client instance
 * @param address - Wallet address
 * @param coinType - Coin type to retrieve (defaults to SUI)
 * @returns Coin details from the blockchain
 */
export async function getCoins(
  client: SuiClient,
  address: string,
  coinType: any = '0x2::sui::SUI'
) {
  const coinAddress = coinType.address ? coinType.address : coinType

  const coinDetails = await client.getCoins({
    owner: address,
    coinType: coinAddress
  })
  return coinDetails
}

/**
 * Gets coin objects for transaction building
 *
 * This function retrieves and prepares coin objects for use in swap transactions.
 * It handles both SUI gas coins and other token types, including coin merging
 * when necessary.
 *
 * @param address - Wallet address
 * @param coin - Coin type or address
 * @param amountIn - Amount needed for the transaction
 * @param txb - Transaction object to build
 * @param client - Sui client instance
 * @returns Transaction result representing the prepared coin
 */
export async function getCoinPTB(
  address: string,
  coin: string,
  amountIn: number | string | bigint,
  txb: Transaction,
  client: SuiClient
) {
  let coinA: TransactionResult

  if (coin === '0x2::sui::SUI') {
    // Handle SUI gas coin
    coinA = txb.splitCoins(txb.gas, [txb.pure.u64(amountIn)])
  } else {
    // Handle other token types
    const coinInfo = await getCoins(client, address, coin)

    // Check if user has enough balance for tokenA
    if (!coinInfo.data[0]) {
      throw new Error('Insufficient balance for this coin')
    }

    // Merge coins if necessary, to cover the amount needed
    const mergedCoin = returnMergedCoins(txb, coinInfo)
    coinA = txb.splitCoins(mergedCoin, [txb.pure.u64(amountIn)])
  }
  return coinA
}

/**
 * Builds a swap transaction from a quote
 *
 * This function constructs a complete swap transaction based on a quote from
 * the aggregator. It handles service fees, multiple routes, and ensures
 * proper transaction structure.
 *
 * @param userAddress - User's wallet address
 * @param txb - Transaction object to build
 * @param minAmountOut - Minimum output amount (slippage protection)
 * @param coinIn - Input coin for the swap
 * @param quote - Quote from the aggregator
 * @param referral - Referral ID for tracking
 * @param ifPrint - Whether to print debug information
 * @param apiKey - API key for aggregator access
 * @param swapOptions - Swap configuration options
 * @returns Transaction result representing the output coin
 */
export async function buildSwapPTBFromQuote(
  userAddress: string,
  txb: Transaction,
  minAmountOut: number,
  coinIn: TransactionResult,
  quote: Quote,
  referral: number = 0,
  ifPrint: boolean = true,
  apiKey?: string,
  swapOptions?: SwapOptions
): Promise<TransactionResult> {
  // Validate quote structure
  if (!quote.routes || quote.routes.length === 0) {
    throw new Error('No routes found in data')
  }

  // Validate amount consistency
  if (
    Number(quote.amount_in) !==
    quote.routes.reduce((sum: number, route: any) => sum + Number(route.amount_in), 0)
  ) {
    throw new Error('Outer amount_in does not match the sum of route amount_in values')
  }

  const serviceFee = swapOptions?.serviceFee || swapOptions?.feeOption

  // Handle service fees if configured
  if (
    serviceFee &&
    serviceFee.fee > 0 &&
    serviceFee.receiverAddress &&
    serviceFee.receiverAddress !== '0x0'
  ) {
    // Process service fee and build fee-related transactions
    const { router, serviceFeeRouter, serviceFeeCoinIn } = await handleServiceFee(
      userAddress,
      txb,
      coinIn,
      quote,
      serviceFee,
      apiKey,
      swapOptions
    )

    // Build main swap and fee swap transactions in parallel
    const [coinOut, feeCoinOut] = await Promise.all([
      buildSwapWithoutServiceFee(userAddress, txb, coinIn, router, minAmountOut, referral, ifPrint),
      !!serviceFeeRouter
        ? serviceFeeRouter.from === serviceFeeRouter.target
          ? serviceFeeCoinIn
          : buildSwapWithoutServiceFee(
              userAddress,
              txb,
              serviceFeeCoinIn,
              serviceFeeRouter,
              0,
              referral,
              ifPrint
            )
        : new Promise((resolve) => {
            resolve(null)
          })
    ])

    // Handle fee coin output
    if (feeCoinOut) {
      emitServiceFeeEvent(txb, coinOut, feeCoinOut as any, serviceFee, router, referral)

      txb.transferObjects([feeCoinOut as any], serviceFee.receiverAddress)
    }

    return coinOut
  }

  // Build swap without service fees
  return await buildSwapWithoutServiceFee(
    userAddress,
    txb,
    coinIn,
    quote,
    minAmountOut,
    referral,
    ifPrint
  )
}

/**
 * Performs a complete swap operation
 *
 * This function orchestrates the entire swap process including:
 * - Quote retrieval from aggregator
 * - Transaction building with service fees
 * - Referral tracking
 *
 * @param address - User's wallet address
 * @param txb - Transaction object to build
 * @param fromCoinAddress - Source coin address
 * @param toCoinAddress - Target coin address
 * @param coin - Input coin for the swap
 * @param amountIn - Amount to swap
 * @param minAmountOut - Minimum output amount (slippage protection). Will be ignored if slippage is provided in swapOptions.
 * @param apiKey - API key for aggregator access
 * @param swapOptions - Swap configuration options. If slippage is provided, it will be used to calculate minAmountOut instead of the minAmountOut parameter.
 * @returns Transaction result representing the output coin
 * @deprecated The minAmountOut parameter is deprecated. Use swapOptions.slippage instead.
 */
export async function swapPTB(
  address: string,
  txb: Transaction,
  fromCoinAddress: string,
  toCoinAddress: string,
  coin: TransactionResult,
  amountIn: number | string | bigint,
  minAmountOut: number,
  apiKey?: string,
  swapOptions: SwapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3,
    ifPrint: true
  }
): Promise<TransactionResult> {
  // Set default swap options
  const options: SwapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3,
    ifPrint: true,
    ...swapOptions
  }

  // Validate that both minAmountOut and slippage are not provided simultaneously
  if (options.slippage !== undefined) {
    // If slippage is provided, validate it
    if (options.slippage < 0 || options.slippage > 1) {
      throw new Error('Slippage must be between 0 and 1 (e.g., 0.01 for 1%)')
    }
    // If both are provided, warn that slippage takes precedence and minAmountOut will be ignored
    // We don't throw an error to maintain backward compatibility, but slippage will be used
  }

  // Generate referral ID if API key is provided
  const refId = apiKey ? generateRefId(apiKey) : 0

  // Get the output coin from the swap route and transfer it to the user
  const quote = await getQuote(fromCoinAddress, toCoinAddress, amountIn, apiKey, options)

  // Calculate minAmountOut from slippage if provided, otherwise use the parameter
  let finalMinAmountOut: number
  if (options.slippage !== undefined) {
    // Priority: slippage takes precedence over minAmountOut
    // Calculate minAmountOut from slippage: amount_out * (1 - slippage)
    // Using toFixed(0) to match frontend behavior (rounds to nearest integer)
    // Note: This will be floored again in buildSwapWithoutServiceFee, but we use rounding here
    // to match the frontend calculation pattern
    finalMinAmountOut = Math.round(Number(quote.amount_out) * (1 - options.slippage))
  } else {
    // Use the deprecated minAmountOut parameter for backward compatibility
    finalMinAmountOut = minAmountOut
  }

  const finalCoinB = await buildSwapPTBFromQuote(
    address,
    txb,
    finalMinAmountOut,
    coin,
    quote,
    refId,
    options.ifPrint,
    apiKey,
    options
  )

  return finalCoinB
}

/**
 * Checks if a transaction was processed by the Navi aggregator
 *
 * This function examines a transaction to determine if it was executed
 * through the Navi aggregator by checking for specific event types.
 *
 * @param digest - Transaction digest to check
 * @param client - Sui client instance
 * @returns Promise<boolean> - True if transaction was processed by Navi aggregator
 */
export async function checkIfNAVIIntegrated(digest: string, client: SuiClient): Promise<boolean> {
  const results = await client.getTransactionBlock({
    digest,
    options: { showEvents: true }
  })
  return (
    results.events?.some((event) =>
      event.type.includes(`${AggregatorConfig.aggregatorContract}::slippage`)
    ) ?? false
  )
}
