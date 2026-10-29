/**
 * Astros Aggregator SDK Package - Main Entry Point
 *
 * This package provides DEX aggregation functionality for the Sui blockchain.
 * It aggregates liquidity from multiple decentralized exchanges to provide the best swap rates.
 *
 * @module AstrosAggregatorSDK
 */

// Export the main Astros SDK functionality
export * from './astros-sdk'

// Export the aggregator library with DEX integrations
export * from './libs/Aggregator'

// Export type definitions for the aggregator SDK
export * from './types'

/** Capability marker for change collection and positive-slippage opt-out. */
export const COMPOSABLE_SWAP_API_VERSION = 1 as const
