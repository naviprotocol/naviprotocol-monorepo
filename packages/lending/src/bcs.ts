import { bcs, fromHex, toHex } from '@mysten/bcs'

export const Address = bcs.bytes(32).transform({
  // To change the input type, you need to provide a type definition for the input
  input: (val: string) => fromHex(val),
  output: (val) => toHex(val)
})

export const IncentiveAPYInfo = bcs.struct('IncentiveAPYInfo', {
  asset_id: bcs.u8(),
  apy: bcs.u256(),
  coin_types: bcs.vector(bcs.string())
})

export const IncentivePoolInfo = bcs.struct('IncentivePoolInfo', {
  pool_id: Address,
  funds: Address,
  phase: bcs.u64(),
  start_at: bcs.u64(),
  end_at: bcs.u64(),
  closed_at: bcs.u64(),
  total_supply: bcs.u64(),
  asset_id: bcs.u8(),
  option: bcs.u8(),
  factor: bcs.u256(),
  distributed: bcs.u64(),
  available: bcs.u256(),
  total: bcs.u256()
})

export const IncentivePoolInfoByPhase = bcs.struct('IncentivePoolInfoByPhase', {
  phase: bcs.u64(),
  pools: bcs.vector(IncentivePoolInfo)
})

export const OracleInfo = bcs.struct('OracleInfo', {
  oracle_id: bcs.u8(),
  price: bcs.u256(),
  decimals: bcs.u8(),
  valid: bcs.bool()
})
export const FlashLoanAssetConfig = bcs.struct('FlashLoanAssetConfig', {
  id: bcs.string(),
  asset_id: bcs.u8(),
  coin_type: bcs.string(),
  pool_id: bcs.string(),
  rate_to_supplier: bcs.u64(),
  rate_to_treasury: bcs.u64(),
  max: bcs.u64(),
  min: bcs.u64()
})

export const ReserveDataInfo = bcs.struct('ReserveDataInfo', {
  id: bcs.u8(),
  oracle_id: bcs.u8(),
  coin_type: bcs.string(),
  supply_cap: bcs.u256(),
  borrow_cap: bcs.u256(),
  supply_rate: bcs.u256(),
  borrow_rate: bcs.u256(),
  supply_index: bcs.u256(),
  borrow_index: bcs.u256(),
  total_supply: bcs.u256(),
  total_borrow: bcs.u256(),
  last_update_at: bcs.u64(),
  ltv: bcs.u256(),
  treasury_factor: bcs.u256(),
  treasury_balance: bcs.u256(),
  base_rate: bcs.u256(),
  multiplier: bcs.u256(),
  jump_rate_multiplier: bcs.u256(),
  reserve_factor: bcs.u256(),
  optimal_utilization: bcs.u256(),
  liquidation_ratio: bcs.u256(),
  liquidation_bonus: bcs.u256(),
  liquidation_threshold: bcs.u256()
})

export const UserStateInfo = bcs.struct('UserStateInfo', {
  asset_id: bcs.u8(),
  borrow_balance: bcs.u256(),
  supply_balance: bcs.u256()
})
