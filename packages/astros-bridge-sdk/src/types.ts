/**
 * Astros Bridge SDK Type Definitions
 *
 * This module contains type definitions for the cross-chain bridge functionality,
 * including chain information, token details, swap quotes, and transaction tracking.
 *
 * @module AstrosBridgeTypes
 */

/**
 * Blockchain network information
 *
 * This type defines the properties of a supported blockchain network
 * for cross-chain bridging operations.
 */
export type Chain = {
  /** Unique chain identifier */
  id: number
  /** Human-readable chain name */
  name: string
  /** URL to chain icon/logo */
  iconUrl: string
  /** Native currency of the chain */
  nativeCurrency: Token
  /** RPC endpoint configuration */
  rpcUrl: {
    /** Default RPC URL for the chain */
    default: string
  }
  /** Block explorer configuration */
  blockExplorers: {
    /** Default block explorer */
    default: {
      /** Explorer URL */
      url: string
      /** Explorer name */
      name: string
    }
  }
}

/**
 * Token information for cross-chain operations
 *
 * This type defines the properties of a token that can be bridged
 * between different blockchain networks.
 */
export type Token = {
  /** Token contract address */
  address: string
  /** Chain ID where this token exists */
  chainId: number
  /** Token decimal places */
  decimals: number
  /** URL to token logo */
  logoURI: string
  /** Human-readable token name */
  name: string
  /** Name of the chain where this token exists */
  chainName: string
  /** Token symbol/ticker */
  symbol: string
  /** Whether this token is suggested for users */
  isSuggest: boolean
  /** Whether this token is verified */
  isVerify: boolean
  /** Token categories/tags */
  category: string[]
}

/**
 * Options for bridge swap operations
 */
export type BridgeSwapOptions = {
  /** Slippage tolerance in basis points (1/10000) */
  slippageBps?: number
  /** Referrer fee in basis points (1/10000) */
  referrerBps?: number
}

/**
 * Quote information for a cross-chain swap
 *
 * This type contains all the information needed to execute a cross-chain swap,
 * including amounts, tokens, fees, and routing information.
 */
export type BridgeSwapQuote = {
  /** Bridge provider name */
  provider: string
  /** Input amount for the swap */
  amount_in: string
  /** Output amount from the swap */
  amount_out: string
  /** Slippage tolerance in basis points */
  slippage_bps: number
  /** Minimum output amount after slippage */
  min_amount_out: string
  /** Source token information */
  from_token: Token
  /** Target token information */
  to_token: Token
  /** Total fee for the bridge operation */
  total_fee: string
  /** Estimated time for the bridge operation */
  spend_duration: number
  /** Additional information for the bridge provider */
  info_for_bridge: any
  /** Token path for the bridge operation */
  path: {
    /** Token in the path */
    token: Token
    /** Amount for this step (optional) */
    amount?: string
  }[]
}

/**
 * Available bridge routes for a swap
 */
export type BridgeRoutes = {
  /** Array of available bridge swap quotes */
  routes: BridgeSwapQuote[]
}

/**
 * Status of a bridge swap transaction
 */
export type BridgeSwapStatus = 'processing' | 'completed' | 'fail'

/**
 * Complete bridge swap transaction information
 *
 * This type contains comprehensive information about a cross-chain swap
 * transaction, including status tracking, amounts, and transaction hashes.
 */
export type BridgeSwapTransaction = {
  /** Unique transaction identifier */
  id: string
  /** Current transaction status */
  status: BridgeSwapStatus
  /** Last update timestamp */
  lastUpdateAt: string
  /** Source chain ID */
  sourceChainId: number
  /** Destination chain ID */
  destChainId: number
  /** Source wallet address */
  walletSourceAddress: string
  /** Destination wallet address */
  walletDestAddress: string
  /** Total fee amount */
  totalFeeAmount: string
  /** Source token details */
  sourceToken: {
    /** Token address */
    address: string
    /** Token symbol */
    symbol: string
    /** Token decimals */
    decimals: number
  }
  /** Destination token details */
  destToken: {
    /** Token address */
    address: string
    /** Token symbol */
    symbol: string
    /** Token decimals */
    decimals: number
  }
  /** Whether this includes a swap operation */
  hasSwap: boolean
  /** Bridge provider name */
  bridgeProvider: string
  /** Bridge operation status */
  bridgeStatus: BridgeSwapStatus
  /** Bridge source token details */
  bridgeFromToken: {
    /** Token address */
    address: string
    /** Token symbol */
    symbol: string
    /** Token decimals */
    decimals: number
  }
  /** Bridge destination token details */
  bridgeToToken: {
    /** Token address */
    address: string
    /** Token symbol */
    symbol: string
    /** Token decimals */
    decimals: number
  }
  /** Bridge source amount */
  bridgeFromAmount: string
  /** Bridge destination amount */
  bridgeToAmount: string
  /** Bridge start timestamp */
  bridgeStartAt: string
  /** Bridge end timestamp (optional) */
  bridgeEndAt?: string
  /** Bridge fee amount */
  bridgeFeeAmount: string
  /** Source chain transaction hash */
  bridgeSourceTxHash: string
  /** Destination chain transaction hash (optional) */
  bridgeDestTxHash?: string
  /** Refund transaction hash (optional) */
  bridgeRefundTxHash?: string
  /** Block explorer link (optional) */
  explorerLink?: string
  /** Mayan-specific data (optional) */
  mayan?: any
}
