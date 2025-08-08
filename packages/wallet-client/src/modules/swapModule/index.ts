/**
 * Swap Module Implementation
 *
 * This module provides DEX swapping functionality for the wallet client.
 * It integrates with the Astros aggregator to find the best swap routes
 * and execute trades across multiple decentralized exchanges.
 *
 * @module SwapModule
 */

import {
  buildSwapPTBFromQuote,
  getQuote,
  Dex,
  FeeOption,
  generateRefId,
  Quote
} from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { Module } from '../module'
import { SuiTransactionBlockResponse, DryRunTransactionBlockResponse } from '@mysten/sui/client'
import BigNumber from 'bignumber.js'
import { mergeCoinsPTB } from '@naviprotocol/lending'
import { executeAuction } from 'shio-sdk'

/**
 * Configuration options for the swap module
 */
export interface SwapModuleConfig {
  /** API key for aggregator access */
  apiKey: string
  /** Base URL for the aggregator API */
  baseUrl: string
  /** List of DEXes to use for routing */
  dexList: Dex[]
  /** Maximum routing depth for finding optimal paths */
  depth: number
  /** Service fee configuration */
  serviceFee: FeeOption | undefined
  /** Environment setting */
  env: 'dev' | 'prod'
}

/**
 * Events emitted by the swap module
 */
export type Events = {
  /** Emitted when a swap is successfully completed */
  'swap:swap-success': {
    /** Source coin type */
    fromCoinType: string
    /** Target coin type */
    toCoinType: string
    /** Input amount */
    fromAmount: number
    /** Applied slippage tolerance */
    slippage: number
    /** Output amount received */
    toAmount: number
  }
}

/**
 * DEX swapping module for wallet operations
 *
 * This module provides functionality for:
 * - Getting swap quotes from multiple DEXes
 * - Executing swaps with slippage protection
 * - Managing swap transactions and events
 * - Integrating with the balance module for coin management
 */
export class SwapModule extends Module<SwapModuleConfig, Events> {
  /** Module name identifier */
  readonly name = 'swap'

  /** Default configuration values */
  readonly defaultConfig: SwapModuleConfig = {
    apiKey: '',
    baseUrl: 'https://open-aggregator-api.naviprotocol.io/find_routes',
    dexList: [],
    depth: 3,
    serviceFee: undefined,
    env: 'prod'
  }

  /**
   * Gets the referral ID for this swap module
   *
   * @returns Referral ID if API key is configured, otherwise 0
   */
  get referral() {
    return this.config.apiKey ? generateRefId(this.config.apiKey) : 0
  }

  /**
   * Get the swap options
   * @returns The swap options
   */
  get swapOptions() {
    return {
      baseUrl: this.config.baseUrl,
      dexList: this.config.dexList,
      depth: this.config.depth,
      serviceFee: this.config.serviceFee
    }
  }

  /**
   * Get a quote for a swap
   * @param fromCoinType - The type of the coin being swapped from
   * @param toCoinType - The type of the coin being swapped to
   * @param fromAmount - The amount of the coin being swapped from
   * @returns A promise that resolves with the quote
   */
  async getQuote(fromCoinType: string, toCoinType: string, fromAmount: number) {
    return getQuote(fromCoinType, toCoinType, fromAmount, this.config.apiKey, this.swapOptions)
  }

  /**
   * Builds a swap transaction from a quote
   * @param tx - The transaction to build the swap from
   * @param quote - The quote to build the swap from
   * @param fromCoin - The coin to swap from
   * @param slippage - The slippage tolerance
   * @returns The swap transaction
   */
  async buildSwapPTBFromQuote(tx: Transaction, quote: Quote, fromCoin: any, slippage: number) {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    const minAmountOut = new BigNumber(quote.amount_out).multipliedBy(1 - slippage).toFixed(0)
    return await buildSwapPTBFromQuote(
      this.walletClient.address,
      tx,
      Number(minAmountOut),
      fromCoin as any,
      quote,
      this.referral,
      false,
      this.config.apiKey,
      this.swapOptions
    )
  }

  /**
   * Executes a swap between two coin types
   *
   * This method performs a complete swap operation including:
   * - Balance validation
   * - Quote retrieval from aggregator
   * - Transaction building with slippage protection
   * - Transaction execution
   * - Event emission on success
   *
   * @param fromCoinType - Source coin type
   * @param toCoinType - Target coin type
   * @param fromAmount - Amount to swap
   * @param slippage - Slippage tolerance (0-1)
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  async swap<T extends boolean = false>(
    fromCoinType: string,
    toCoinType: string,
    fromAmount: number,
    slippage: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Wait for latest balance update
    await this.walletClient.module('balance').waitForUpdate()

    // Get current balance for the source coin
    const fromCoinBalance = this.walletClient.module('balance').portfolio.getBalance(fromCoinType)

    // Build transaction
    const tx = new Transaction()

    // Merge coins for the swap input
    const fromCoin = mergeCoinsPTB(tx, fromCoinBalance.coins, {
      balance: fromAmount,
      useGasCoin: true
    })

    // Get quote from aggregator
    const quote = await this.getQuote(fromCoinType, toCoinType, fromAmount)

    // Build swap transaction from quote
    const coinOut = await this.buildSwapPTBFromQuote(tx, quote, fromCoin, slippage)

    // Transfer output coins to wallet
    tx.transferObjects([coinOut], this.walletClient.address)

    // Set sender address
    tx.setSender(this.walletClient.address)

    if (options?.dryRun) {
      const result = await this.walletClient.signExecuteTransaction({
        transaction: tx,
        dryRun: true
      })
      return result as any
    }

    const builtTx = await tx.build({
      client: this.walletClient.client
    })

    const signed = await this.walletClient.signer.signTransaction(builtTx)
    const signatures = [signed.signature]

    try {
      await executeAuction(signed.bytes, signatures)
    } catch (e) {
      console.error(e)
    }

    const result = await this.walletClient.client.executeTransactionBlock({
      transactionBlock: signed!.bytes,
      signature: signatures,
      options: {
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true
      }
    })

    if (result.effects?.status?.status === 'success') {
      // Find slippage event to get actual output amount
      const slippageEvent = result.events?.find((event) => {
        return event.type.includes('::slippage::SwapEvent')
      })

      if (slippageEvent) {
        // Emit swap success event with actual amounts
        this.emit('swap:swap-success', {
          fromCoinType,
          toCoinType,
          fromAmount,
          slippage,
          toAmount: Number((slippageEvent.parsedJson as any).amount_out)
        })
      }

      // Update balance portfolio after successful swap
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }
}
