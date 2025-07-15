/**
 * Astros Bridge SDK Package - Main Entry Point
 *
 * This package provides cross-chain bridge functionality for the Sui blockchain.
 * It enables users to transfer tokens between different blockchain networks through
 * various bridge providers like Mayan.
 *
 * @module AstrosBridgeSDK
 */

import { Chain, Token, BridgeSwapOptions, BridgeSwapQuote, BridgeSwapTransaction } from './types'
import * as mayan from './providers/mayan'
import { WalletConnection } from './providers/mayan'
import { apiInstance, config } from './config'

// Export configuration for the bridge SDK
export { config }

/**
 * Retrieves a list of supported blockchain networks for bridging
 * @returns Promise<Chain[]> - Array of supported blockchain networks
 */
export async function getSupportChains(): Promise<Chain[]> {
  const res = await apiInstance.get<{
    data: {
      chains: Chain[]
    }
  }>('/chains/list')
  return res.data.data.chains
}

/**
 * Retrieves a list of supported tokens for a specific blockchain
 * @param chainId - The ID of the blockchain network
 * @param page - Page number for pagination (default: 1)
 * @param pageSize - Number of tokens per page (default: 100)
 * @returns Promise<Token[]> - Array of supported tokens
 */
export async function getSupportTokens(
  chainId: number,
  page: number = 1,
  pageSize: number = 100
): Promise<Token[]> {
  const res = await apiInstance.get<{
    data: {
      list: Token[]
    }
  }>('/coins/support-token-list', {
    params: {
      chain: chainId,
      page,
      pageSize,
      scene: 'bridge'
    }
  })
  return res.data.data.list
}

/**
 * Searches for supported tokens by keyword on a specific blockchain
 * @param chainId - The ID of the blockchain network
 * @param keyword - Search keyword for token name or symbol
 * @returns Promise<Token[]> - Array of matching tokens
 */
export async function searchSupportTokens(chainId: number, keyword: string): Promise<Token[]> {
  const res = await apiInstance.get<{
    data: {
      list: Token[]
    }
  }>('/coins/search', {
    params: {
      chain: chainId,
      keyword,
      page: 1,
      pageSize: 30,
      scene: 'bridge'
    }
  })
  return res.data.data.list
}

/**
 * Gets a quote for cross-chain token swap
 * @param from - Source token information
 * @param to - Destination token information
 * @param amount - Amount to swap
 * @param options - Optional swap parameters (slippage, referrer fees)
 * @returns Promise<{routes: BridgeSwapQuote[]}> - Available swap routes
 */
export async function getQuote(
  from: Token,
  to: Token,
  amount: string | number,
  options?: BridgeSwapOptions
) {
  const res = await apiInstance.get<{
    data: {
      routes: BridgeSwapQuote[]
    }
  }>('/bridge-swap/find_routes', {
    params: {
      from: from.address,
      to: to.address,
      fromChain: from.chainId,
      toChain: to.chainId,
      amount,
      slippageBps: options?.slippageBps,
      referrerBps: options?.referrerBps
    }
  })
  // Temporary fix for chain ID parsing
  const rtn = res.data.data
  rtn.routes.forEach((router: any) => {
    if (router.from_token.chain) {
      router.from_token.chainId = parseInt(router.from_token.chain)
    }
    if (router.to_token.chain) {
      router.to_token.chainId = parseInt(router.to_token.chain)
    }
  })
  return rtn
}

/**
 * Retrieves transaction details by transaction hash
 * @param hash - Transaction hash to look up
 * @returns Promise<BridgeSwapTransaction> - Transaction details
 */
export async function getTransaction(hash: string) {
  const res = await apiInstance.get<{
    data: {
      transaction: BridgeSwapTransaction
    }
  }>(`/bridge-swap/transaction/${hash}`)
  return res.data.data.transaction
}

/**
 * Retrieves wallet transaction history
 * @param address - Wallet address to get transactions for
 * @param page - Page number for pagination (default: 1)
 * @param limit - Number of transactions per page (default: 10)
 * @returns Promise<{transactions: BridgeSwapTransaction[]}> - Transaction history
 */
export async function getWalletTransactions(address: string, page: number = 1, limit: number = 10) {
  const res = await apiInstance.get<{
    data: {
      transactions: BridgeSwapTransaction[]
    }
  }>(`/bridge-swap/transactions/list`, {
    params: {
      address,
      page,
      limit
    }
  })
  return res.data.data
}

/**
 * Executes a cross-chain token swap
 * @param quote - The swap quote to execute
 * @param fromAddress - Source wallet address
 * @param toAddress - Destination wallet address
 * @param walletConnection - Wallet connection for signing
 * @param referrerAddresses - Optional referrer addresses for different chains
 * @returns Promise<BridgeSwapTransaction> - Transaction details
 */
export async function swap(
  quote: BridgeSwapQuote,
  fromAddress: string,
  toAddress: string,
  walletConnection: WalletConnection,
  referrerAddresses?: {
    sui?: string
    evm?: string
    solana?: string
  }
): Promise<BridgeSwapTransaction> {
  const startAt = new Date().toISOString()
  const hash = await mayan.swap(quote, fromAddress, toAddress, walletConnection, referrerAddresses)
  const endAt = new Date().toISOString()

  // Prepare token information for the transaction record
  const sourceToken = {
    address: quote.from_token.address,
    symbol: quote.from_token.symbol,
    decimals: quote.from_token.decimals
  }
  const destToken = {
    address: quote.to_token.address,
    symbol: quote.to_token.symbol,
    decimals: quote.to_token.decimals
  }

  // Return transaction details
  return {
    id: hash,
    status: 'processing',
    lastUpdateAt: endAt,
    sourceChainId: quote.from_token.chainId,
    destChainId: quote.to_token.chainId,
    walletSourceAddress: fromAddress,
    walletDestAddress: toAddress,
    totalFeeAmount: quote.total_fee,
    sourceToken: quote.from_token,
    destToken: quote.to_token,
    bridgeFromAmount: quote.amount_in,
    bridgeToAmount: quote.amount_out,
    bridgeStartAt: startAt,
    bridgeEndAt: endAt,
    bridgeFeeAmount: '0',
    bridgeSourceTxHash: hash,
    bridgeDestTxHash: '',
    bridgeRefundTxHash: '',
    bridgeStatus: 'processing',
    bridgeProvider: 'mayan',
    bridgeFromToken: sourceToken,
    bridgeToToken: destToken,
    hasSwap: false
  }
}
