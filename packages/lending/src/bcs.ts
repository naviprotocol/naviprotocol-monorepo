/**
 * BCS (Binary Canonical Serialization) Schemas for Lending Protocol
 *
 * This module defines the BCS schemas for serializing and deserializing
 * lending protocol data structures. BCS is used for efficient binary
 * encoding of complex data types for blockchain transactions and storage.
 */

import { bcs, fromHex, toHex } from '@mysten/bcs'

/**
 * BCS schema for Sui addresses with hex transformation
 * Converts between hex string representation and byte arrays
 */
export const Address = bcs.bytes(32).transform({
  // To change the input type, you need to provide a type definition for the input
  input: (val: string) => fromHex(val),
  output: (val) => toHex(val)
})

/**
 * BCS schema for incentive APY information
 * Contains asset ID, APY value, and supported coin types
 */
export const IncentiveAPYInfo = bcs.struct('IncentiveAPYInfo', {
  /** Asset identifier */
  asset_id: bcs.u8(),
  /** Annual Percentage Yield as a 256-bit integer */
  apy: bcs.u256(),
  /** List of supported coin types for this incentive */
  coin_types: bcs.vector(bcs.string())
})

/**
 * BCS schema for incentive pool information
 * Contains comprehensive details about a lending incentive pool
 */
export const IncentivePoolInfo = bcs.struct('IncentivePoolInfo', {
  /** Unique pool identifier */
  pool_id: Address,
  /** Address holding the incentive funds */
  funds: Address,
  /** Current phase of the incentive program */
  phase: bcs.u64(),
  /** Timestamp when the incentive started */
  start_at: bcs.u64(),
  /** Timestamp when the incentive ends */
  end_at: bcs.u64(),
  /** Timestamp when the incentive was closed */
  closed_at: bcs.u64(),
  /** Total supply of incentive tokens */
  total_supply: bcs.u64(),
  /** Asset identifier for the incentive */
  asset_id: bcs.u8(),
  /** Option type for the incentive */
  option: bcs.u8(),
  /** Factor used in incentive calculations */
  factor: bcs.u256(),
  /** Amount of incentives already distributed */
  distributed: bcs.u64(),
  /** Amount of incentives currently available */
  available: bcs.u256(),
  /** Total amount of incentives */
  total: bcs.u256()
})

/**
 * BCS schema for incentive pool information grouped by phase
 * Contains phase number and list of pools in that phase
 */
export const IncentivePoolInfoByPhase = bcs.struct('IncentivePoolInfoByPhase', {
  /** Phase number */
  phase: bcs.u64(),
  /** List of incentive pools in this phase */
  pools: bcs.vector(IncentivePoolInfo)
})

/**
 * BCS schema for oracle price information
 * Contains price data from external price feeds
 */
export const OracleInfo = bcs.struct('OracleInfo', {
  /** Oracle identifier */
  oracle_id: bcs.u8(),
  /** Current price as a 256-bit integer */
  price: bcs.u256(),
  /** Number of decimal places for the price */
  decimals: bcs.u8(),
  /** Whether the oracle data is valid */
  valid: bcs.bool()
})

/**
 * BCS schema for flash loan asset configuration
 * Contains parameters for flash loan functionality
 */
export const FlashLoanAssetConfig = bcs.struct('FlashLoanAssetConfig', {
  /** Unique identifier for the flash loan asset */
  id: bcs.string(),
  /** Asset identifier */
  asset_id: bcs.u8(),
  /** Coin type for the asset */
  coin_type: bcs.string(),
  /** Pool identifier for the flash loan */
  pool_id: bcs.string(),
  /** Rate paid to suppliers for flash loans */
  rate_to_supplier: bcs.u64(),
  /** Rate paid to treasury for flash loans */
  rate_to_treasury: bcs.u64(),
  /** Maximum flash loan amount */
  max: bcs.u64(),
  /** Minimum flash loan amount */
  min: bcs.u64()
})

/**
 * BCS schema for reserve data information
 * Contains comprehensive details about a lending reserve
 */
export const ReserveDataInfo = bcs.struct('ReserveDataInfo', {
  /** Reserve identifier */
  id: bcs.u8(),
  /** Oracle identifier for price feeds */
  oracle_id: bcs.u8(),
  /** Coin type for the reserve */
  coin_type: bcs.string(),
  /** Maximum supply capacity */
  supply_cap: bcs.u256(),
  /** Maximum borrow capacity */
  borrow_cap: bcs.u256(),
  /** Current supply interest rate */
  supply_rate: bcs.u256(),
  /** Current borrow interest rate */
  borrow_rate: bcs.u256(),
  /** Current supply index for interest calculation */
  supply_index: bcs.u256(),
  /** Current borrow index for interest calculation */
  borrow_index: bcs.u256(),
  /** Total amount supplied to the reserve */
  total_supply: bcs.u256(),
  /** Total amount borrowed from the reserve */
  total_borrow: bcs.u256(),
  /** Timestamp of last update */
  last_update_at: bcs.u64(),
  /** Loan-to-Value ratio for collateral */
  ltv: bcs.u256(),
  /** Treasury factor for fee calculations */
  treasury_factor: bcs.u256(),
  /** Current treasury balance */
  treasury_balance: bcs.u256(),
  /** Base interest rate */
  base_rate: bcs.u256(),
  /** Interest rate multiplier */
  multiplier: bcs.u256(),
  /** Jump rate multiplier for high utilization */
  jump_rate_multiplier: bcs.u256(),
  /** Reserve factor for protocol fees */
  reserve_factor: bcs.u256(),
  /** Optimal utilization rate */
  optimal_utilization: bcs.u256(),
  /** Liquidation ratio threshold */
  liquidation_ratio: bcs.u256(),
  /** Liquidation bonus for liquidators */
  liquidation_bonus: bcs.u256(),
  /** Liquidation threshold */
  liquidation_threshold: bcs.u256()
})

/**
 * BCS schema for user state information
 * Contains user's borrowing and supplying balances for an asset
 */
export const UserStateInfo = bcs.struct('UserStateInfo', {
  /** Asset identifier */
  asset_id: bcs.u8(),
  /** User's current borrow balance */
  borrow_balance: bcs.u256(),
  /** User's current supply balance */
  supply_balance: bcs.u256()
})
