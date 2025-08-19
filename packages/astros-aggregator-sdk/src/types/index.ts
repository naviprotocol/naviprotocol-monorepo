/**
 * Astros Aggregator Type Definitions
 *
 * This module contains type definitions for the DEX aggregator functionality,
 * including supported DEXes, quote structures, and swap options.
 *
 * @module AstrosAggregatorTypes
 */

/**
 * Enumeration of supported decentralized exchanges (DEXes)
 *
 * This enum defines all the DEX protocols that the aggregator can interact with
 * to find the best swap routes and execute trades.
 */
export enum Dex {
  /** Cetus DEX protocol */
  CETUS = 'cetus',
  /** Turbos DEX protocol */
  TURBOS = 'turbos',
  /** Kriya V2 DEX protocol */
  KRIYA_V2 = 'kriyaV2',
  /** Kriya V3 DEX protocol */
  KRIYA_V3 = 'kriyaV3',
  /** Aftermath DEX protocol */
  AFTERMATH = 'aftermath',
  /** DeepBook DEX protocol */
  DEEPBOOK = 'deepbook',
  /** Bluefin DEX protocol */
  BLUEFIN = 'bluefin',
  /** vSui DEX protocol */
  VSUI = 'vSui',
  /** haSui DEX protocol */
  HASUI = 'haSui',
  /** Magma DEX protocol */
  MAGMA = 'magma',
  /** Momentum DEX protocol */
  MOMENTUM = 'momentum',
  /** FlowX DEX protocol */
  FLOWX = 'flowx'
}

/**
 * Quote information for a swap operation
 *
 * This type contains all the information needed to execute a swap,
 * including available routes, amounts, and token details.
 */
export type Quote = {
  /** Available swap routes from different DEXes */
  routes: any[]
  /** Input amount for the swap */
  amount_in: string
  /** Output amount from the swap */
  amount_out: string
  /** Source token address */
  from: string
  /** Target token address */
  target: string
  /** List of DEXes used in the routes */
  dexList: Dex[]
  /** Source token information */
  from_token?: {
    /** Token contract address */
    address: string
    /** Token decimal places */
    decimals: number
    /** Current token price */
    price: number
  }
  /** Target token information */
  to_token?: {
    /** Token contract address */
    address: string
    /** Token decimal places */
    decimals: number
    /** Current token price */
    price: number
  }
  /** Whether the quote is accurate */
  is_accurate?: boolean
}

/**
 * Fee configuration for swap operations
 */
export type FeeOption = {
  /** Fee amount in basis points (1/10000) */
  fee: number
  /** Address to receive the fee */
  receiverAddress: string
}

/**
 * Options for swap operations
 *
 * This type configures various aspects of the swap process including
 * DEX selection, routing depth, and fee handling.
 */
export type SwapOptions = {
  /** Custom base URL for the aggregator API */
  baseUrl?: string
  /** List of DEXes to use for routing */
  dexList?: Dex[]
  /** Whether the amount is input amount (true) or output amount (false) */
  byAmountIn?: boolean
  /** Maximum routing depth for finding optimal paths */
  depth?: number
  /** Fee configuration for the swap */
  feeOption?: FeeOption
  /** Whether to print debug information */
  ifPrint?: boolean
  /** Service fee configuration */
  serviceFee?: FeeOption
}
