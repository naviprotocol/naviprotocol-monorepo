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
import {
  NaviAggregatorCoinClient,
  NaviAggregatorTransactionQueryClient,
  Quote,
  SingleCoinTransactionResult,
  SwapOptions
} from '../../types'
import { Transaction, TransactionResult } from '@mysten/sui/transactions'
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
  client: NaviAggregatorCoinClient,
  address: string,
  coinType: any = '0x2::sui::SUI'
) {
  const coinAddress = coinType.address ? coinType.address : coinType
  const core = client.core as
    | {
        listCoins?(options: any): Promise<any>
      }
    | undefined

  if (typeof core?.listCoins === 'function') {
    const data: any[] = []
    let cursor: string | null | undefined = null
    do {
      const response = await core.listCoins({
        owner: address,
        coinType: coinAddress,
        cursor,
        limit: 100
      })
      const objects = response.objects ?? response.data ?? []
      // gRPC listCoins returns native fields (objectId / type=`Coin<T>` / owner),
      // whereas the v1 JSON-RPC getCoins returned a CoinStruct (coinObjectId /
      // coinType=T). Normalize back to the v1 shape so consumers (e.g. callers
      // reading coinObjectId) do not get undefined under v2 — keep behavior
      // consistent across the migration.
      for (const o of objects) {
        // Already a CoinStruct (legacy branch / already mapped): keep as-is.
        if (o && typeof o === 'object' && 'coinObjectId' in o) {
          data.push(o)
          continue
        }
        const rawType: string | undefined = o?.type
        // type looks like `0x…2::coin::Coin<INNER>` (gRPC may use a normalized full address); take INNER as coinType
        const coinTypeMatch =
          typeof rawType === 'string' ? rawType.match(/::coin::Coin<(.+)>$/) : null
        const coinObjectId = o?.objectId ?? o?.coinObjectId
        const balance = o?.balance
        // Drop incomplete entries (same semantics as lending's normalizeCoreCoin):
        // an object without an id or balance cannot be selected/merged safely.
        if (!coinObjectId || balance === undefined || balance === null) {
          continue
        }
        data.push({
          coinType: coinTypeMatch ? coinTypeMatch[1] : coinAddress,
          coinObjectId,
          version: o?.version,
          digest: o?.digest,
          balance,
          previousTransaction: o?.previousTransaction ?? o?.previous_transaction
        })
      }
      cursor = response.cursor ?? response.nextCursor ?? null
    } while (cursor)
    return {
      data,
      nextCursor: null,
      hasNextPage: false
    }
  }

  if (typeof client.getCoins !== 'function') {
    throw new Error(
      'Aggregator coin selection requires core.listCoins or an explicit legacy getCoins client'
    )
  }

  const coinDetails = await client.getCoins({
    owner: address,
    coinType: coinAddress
  })
  return coinDetails
}

function getCoinObjectId(coin: { coinObjectId?: string; objectId?: string }) {
  const objectId = coin.coinObjectId ?? coin.objectId
  if (!objectId) {
    throw new Error('Coin object is missing coinObjectId/objectId')
  }
  return objectId
}

/**
 * Read a coin's combined balance via the v2 Core `getBalance`.
 *
 * On Sui, a fungible balance is `coinBalance` (sum of `Coin<T>` objects) plus
 * `addressBalance` (funds held directly at the address, arriving via
 * `send_funds()`). `listCoins`/`getCoins` only see coin objects, so sufficiency
 * checks based on them under-count once address balances are in play. This reads
 * the authoritative combined total so callers can source the shortfall from the
 * address balance.
 *
 * Returns `null` when the injected client exposes no `core.getBalance`
 * (legacy path) — callers then fall back to coin-object-only behavior.
 */
async function getCombinedBalance(
  client: NaviAggregatorCoinClient,
  owner: string,
  coinType: string
): Promise<{ total: bigint; addressBalance: bigint } | null> {
  const core = client.core as { getBalance?(options: any): Promise<any> } | undefined
  if (typeof core?.getBalance !== 'function') {
    return null
  }
  let response: any
  try {
    response = await core.getBalance({ owner, coinType })
  } catch {
    // Transient getBalance failure: fall back to coin-object-only selection
    // instead of aborting the build (matches wallet-client's address-balance
    // fetch, which catches and falls back).
    return null
  }
  // Core getBalance may return `{ balance: {...} }` or a flat object. Only take a
  // nested object as the balance; if `balance` is a scalar (the numeric total on
  // the flat shape) fall back to the response itself, so addressBalance is read
  // from the right place instead of collapsing to 0. Also accept the
  // `fundsInAddressBalance` alias (matching lending's normalizeAddressBalance).
  const nested = response?.balance
  const balance =
    nested && typeof nested === 'object'
      ? nested
      : response && typeof response === 'object'
        ? response
        : null
  if (!balance) {
    return null
  }
  const total = BigInt(balance.balance ?? balance.totalBalance ?? 0)
  const addressBalance = BigInt(balance.addressBalance ?? balance.fundsInAddressBalance ?? 0)
  return { total, addressBalance }
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
  client: NaviAggregatorCoinClient
): Promise<SingleCoinTransactionResult> {
  let coinA: TransactionResult

  if (coin === '0x2::sui::SUI') {
    // Handle SUI gas coin
    coinA = txb.splitCoins(txb.gas, [txb.pure.u64(amountIn)])
  } else {
    // Handle other token types
    const coinInfo = await getCoins(client, address, coin)
    const objects = coinInfo.data ?? []
    const objectsBalance = objects.reduce((sum: bigint, c: any) => sum + BigInt(c.balance ?? 0), 0n)
    const need = BigInt(amountIn)

    // Address balances (v2): part of the balance can live at the address level
    // (not as Coin<T> objects). `getCoins` only sees coin objects, so validate
    // against the combined balance and, when the objects fall short, withdraw
    // the remainder from the address balance via `0x2::coin::redeem_funds`.
    const combined = await getCombinedBalance(client, address, coin)
    const addressBalance = combined ? combined.addressBalance : 0n
    // Combined spendable = owned coin objects + address balance. Sizing both the
    // sufficiency check and the shortfall from the same `objectsBalance` keeps the
    // redeemed amount from ever exceeding the available address balance.
    const total = objectsBalance + addressBalance

    // Check if user has enough balance for tokenA
    if (total < need) {
      throw new Error(`Insufficient balance: need ${need}, have ${total}`)
    }

    // Base coin + merge list: all owned Coin<T> objects (largest first), plus a
    // coin redeemed from the address balance to cover any shortfall.
    const sorted = [...objects].sort((a: any, b: any) =>
      Number(BigInt(b.balance ?? 0) - BigInt(a.balance ?? 0))
    )
    let baseCoin: any
    const mergeList: any[] = []
    for (const c of sorted) {
      const obj = txb.object(getCoinObjectId(c))
      if (baseCoin === undefined) {
        baseCoin = obj
      } else {
        mergeList.push(obj)
      }
    }

    const shortfall = objectsBalance >= need ? 0n : need - objectsBalance
    if (shortfall > 0n) {
      const withdrawnCoin = txb.moveCall({
        target: '0x2::coin::redeem_funds',
        typeArguments: [coin],
        arguments: [txb.withdrawal({ amount: shortfall, type: coin })]
      })
      if (baseCoin === undefined) {
        baseCoin = withdrawnCoin
      } else {
        mergeList.push(withdrawnCoin)
      }
    }

    if (baseCoin === undefined) {
      throw new Error('Insufficient balance for this coin')
    }
    if (mergeList.length > 0) {
      txb.mergeCoins(baseCoin, mergeList)
    }

    coinA = txb.splitCoins(baseCoin, [txb.pure.u64(amountIn)])
  }
  return coinA as SingleCoinTransactionResult
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
 * @param minAmountOut - Minimum output amount (slippage protection). Will be ignored if slippage is provided in swapOptions. Optional, deprecated - use swapOptions.slippage instead.
 * @param coinIn - Input coin for the swap
 * @param quote - Quote from the aggregator
 * @param referral - Referral ID for tracking
 * @param ifPrint - Whether to print debug information
 * @param apiKey - API key for aggregator access
 * @param swapOptions - Swap configuration options. If slippage is provided, it will be used to calculate minAmountOut instead of the minAmountOut parameter.
 * @returns Transaction result representing the output coin
 */
export async function buildSwapPTBFromQuote(
  userAddress: string,
  txb: Transaction,
  minAmountOut: number | undefined,
  coinIn: TransactionResult,
  quote: Quote,
  referral: number = 0,
  ifPrint: boolean = true,
  apiKey?: string,
  swapOptions?: SwapOptions
): Promise<SingleCoinTransactionResult> {
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

  // Calculate final minAmountOut from slippage if provided, otherwise use the deprecated parameter
  let finalMinAmountOut: number
  if (swapOptions?.slippage !== undefined) {
    // Validate slippage value
    if (swapOptions.slippage < 0 || swapOptions.slippage > 1) {
      throw new Error('Slippage must be between 0 and 1 (e.g., 0.01 for 1%)')
    }
    // Priority: slippage takes precedence over minAmountOut
    // Calculate minAmountOut from slippage: amount_out * (1 - slippage)
    // Using Math.round to match frontend behavior (rounds to nearest integer)
    // Note: This will be floored again in buildSwapWithoutServiceFee, but we use rounding here
    // to match the frontend calculation pattern
    const calculatedMin = Number(quote.amount_out) * (1 - swapOptions.slippage)
    finalMinAmountOut = Math.round(calculatedMin)
    // Ensure minAmountOut is at least 1 if the original amount_out is greater than 0
    // This prevents slippage protection from being completely disabled for small amounts
    if (Number(quote.amount_out) > 0 && finalMinAmountOut === 0) {
      finalMinAmountOut = 1
    }
  } else {
    // Use the deprecated minAmountOut parameter for backward compatibility
    if (minAmountOut === undefined) {
      throw new Error(
        'Either slippage in swapOptions or minAmountOut parameter must be provided for slippage protection'
      )
    }
    finalMinAmountOut = minAmountOut
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
      buildSwapWithoutServiceFee(
        userAddress,
        txb,
        coinIn,
        router,
        finalMinAmountOut,
        referral,
        ifPrint,
        swapOptions
      ),
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
              ifPrint,
              swapOptions
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

    return coinOut as SingleCoinTransactionResult
  }

  // Build swap without service fees
  return await buildSwapWithoutServiceFee(
    userAddress,
    txb,
    coinIn,
    quote,
    finalMinAmountOut,
    referral,
    ifPrint,
    swapOptions
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
 * @param minAmountOut - Minimum output amount (slippage protection). Will be ignored if slippage is provided in swapOptions. Optional, deprecated - use swapOptions.slippage instead.
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
  minAmountOut?: number,
  apiKey?: string,
  swapOptions: SwapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3,
    ifPrint: true
  }
): Promise<SingleCoinTransactionResult> {
  // Set default swap options
  const options: SwapOptions = {
    baseUrl: undefined,
    dexList: [],
    byAmountIn: true,
    depth: 3,
    ifPrint: true,
    ...swapOptions
  }

  // Validate slippage protection: must provide either slippage or minAmountOut
  if (options.slippage !== undefined) {
    // If slippage is provided, validate it
    if (options.slippage < 0 || options.slippage > 1) {
      throw new Error('Slippage must be between 0 and 1 (e.g., 0.01 for 1%)')
    }
    // If both are provided, slippage takes precedence and minAmountOut will be ignored
  } else {
    // If no slippage is provided, minAmountOut parameter must be provided
    if (minAmountOut === undefined) {
      throw new Error(
        'Either slippage in swapOptions or minAmountOut parameter must be provided for slippage protection'
      )
    }
  }

  // Generate referral ID if API key is provided
  const refId = apiKey ? generateRefId(apiKey) : 0

  // Get the output coin from the swap route and transfer it to the user
  const quote = await getQuote(fromCoinAddress, toCoinAddress, amountIn, apiKey, options)

  const finalCoinB = await buildSwapPTBFromQuote(
    address,
    txb,
    minAmountOut,
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
export async function checkIfNAVIIntegrated(
  digest: string,
  client: NaviAggregatorTransactionQueryClient
): Promise<boolean> {
  const core = client.core as
    | {
        getTransaction?(options: any): Promise<any>
      }
    | undefined
  if (typeof core?.getTransaction === 'function') {
    const response = await core.getTransaction({
      digest,
      include: {
        events: true
      }
    })
    const transaction = response.Transaction ?? response.FailedTransaction ?? response
    return (
      transaction.events?.some((event: any) =>
        event.type.includes(`${AggregatorConfig.aggregatorContract}::slippage`)
      ) ?? false
    )
  }

  if (typeof client.getTransactionBlock !== 'function') {
    throw new Error(
      'Aggregator transaction lookup requires core.getTransaction or an explicit legacy getTransactionBlock client'
    )
  }

  const results = await client.getTransactionBlock({
    digest,
    options: { showEvents: true }
  })
  return (
    results.events?.some((event: any) =>
      event.type.includes(`${AggregatorConfig.aggregatorContract}::slippage`)
    ) ?? false
  )
}
