import { bcs, type BcsType } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Vault, CacheOption } from '../../types'
import { getSuiClient, withCache, withSingleton } from '../../utils'
import { checkVault } from './utils'
import { DEFAULT_CACHE_TIME, getPools } from '@naviprotocol/lending'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { vaultErrors } from '../../error'

const UID = bcs.Address

const Balance = bcs.struct('Balance', {
  value: bcs.u64()
})

/** `sui::table::Table` / `sui::bag::Bag` — only the handle is inlined in the parent object. */
const TableHandle = bcs.struct('Table', {
  id: UID,
  size: bcs.u64()
})

function vecMap<K extends BcsType<any>, V extends BcsType<any>>(keyType: K, valueType: V) {
  return bcs.struct('VecMap', {
    contents: bcs.vector(
      bcs.struct('Entry', {
        key: keyType,
        value: valueType
      })
    )
  })
}

const AccountCap = bcs.struct('AccountCap', {
  id: UID,
  owner: bcs.Address
})

const MarketStatus = bcs.enum('MarketStatus', {
  Active: null,
  Disabled: null
})

const MarketInfo = bcs.struct('MarketInfo', {
  cap: bcs.u64(),
  penalty: bcs.u64(),
  current_balance: bcs.u64(),
  loss: bcs.u64(),
  last_sync_at: bcs.u64(),
  storage_address: bcs.Address,
  asset_id: bcs.u8(),
  incentive_v3_address: bcs.Address,
  incentive_v2_address: bcs.Address,
  account_cap: bcs.option(AccountCap),
  status: MarketStatus
})

const VaultRewardRuleStruct = bcs.struct('VaultRewardRule', {
  navi_pool_id: bcs.Address,
  // `std::ascii::String`, i.e. a length-prefixed byte vector
  reward_coin_type: bcs.string(),
  incentive_rule_id: bcs.Address,
  vault_reward_index: bcs.u256(),
  last_harvest_at: bcs.u64(),
  is_vault_native: bcs.bool(),
  reward_rate: bcs.u256(),
  is_active: bcs.bool(),
  total_reward_deposited: bcs.u64(),
  total_reward_distributed: bcs.u64()
})

const VaultStruct = bcs.struct('Vault', {
  id: UID,
  version: bcs.u64(),
  total_shares: bcs.u64(),
  idle_balance: Balance,
  default_market: bcs.Address,
  management_fee: bcs.u64(),
  performance_fee: bcs.u64(),
  total_assets: bcs.u64(),
  last_update_timestamp: bcs.u64(),
  markets: vecMap(bcs.Address, MarketInfo),
  pending_management_fee_shares: bcs.u64(),
  pending_performance_fee_shares: bcs.u64(),
  reward_rules: bcs.vector(VaultRewardRuleStruct),
  collected_rewards: TableHandle,
  user_states: TableHandle,
  paused: bcs.bool(),
  vault_cap: bcs.u64()
})

/** `sui::balance::Balance` inlined in the vault object. */
export type VaultBalance = {
  value: string
}

/** `sui::table::Table` / `sui::bag::Bag` handle inlined in the parent object. */
export type VaultTableHandle = {
  id: string
  size: string
}

export type VaultAccountCap = {
  id: string
  owner: string
}

export type VaultMarketStatus =
  | { $kind: 'Active'; Active: true; Disabled?: never }
  | { $kind: 'Disabled'; Disabled: true; Active?: never }

/** One registered lending market on the vault. */
export type VaultMarketInfo = {
  cap: string
  penalty: string
  current_balance: string
  loss: string
  last_sync_at: string
  storage_address: string
  asset_id: number
  incentive_v3_address: string
  incentive_v2_address: string
  account_cap: VaultAccountCap | null
  status: VaultMarketStatus
}

/** One entry in the vault's `VecMap<address, MarketInfo>`. */
export type VaultMarketEntry = {
  key: string
  value: VaultMarketInfo
}

/** Raw on-chain reward rule before SDK normalization. */
export type VaultRewardRuleInfo = {
  navi_pool_id: string
  reward_coin_type: string
  incentive_rule_id: string
  vault_reward_index: string
  last_harvest_at: string
  is_vault_native: boolean
  reward_rate: string
  is_active: boolean
  total_reward_deposited: string
  total_reward_distributed: string
}

/** Parsed on-chain `navi_vault::Vault<CoinType>` object fields. */
export type VaultInfo = {
  id: string
  version: string
  total_shares: string
  idle_balance: VaultBalance
  default_market: string
  management_fee: string
  performance_fee: string
  total_assets: string
  last_update_timestamp: string
  markets: { contents: VaultMarketEntry[] }
  pending_management_fee_shares: string
  pending_performance_fee_shares: string
  reward_rules: VaultRewardRuleInfo[]
  collected_rewards: VaultTableHandle
  user_states: VaultTableHandle
  paused: boolean
  vault_cap: string
}

/** A single reward distribution rule of a NAVI vault. */
export type VaultRewardRule = {
  /** Position in the append-only on-chain `reward_rules` vector — the `rule_index` `collect_reward` takes. */
  ruleIndex: number
  /**
   * Key the vault uses to track per-user reward state
   * (`reward_indices` / `reward_total` / `reward_claimed`), built as `<pool>|<coinType>`
   * with both parts un-prefixed, mirroring `navi_vault::get_rule_key`.
   */
  ruleKey: string
  /** NAVI lending pool the market reward comes from. `0x0…0` for vault-native rules. */
  naviPoolId: string
  /** Reward coin type, normalized to a `0x`-prefixed struct tag. */
  rewardCoinType: string
  /** `incentive_v3` rule id harvested by `collect_reward`. `0x0…0` for vault-native rules. */
  incentiveRuleId: string
  /** Cumulative reward per share, RAY (1e27) scaled. */
  vaultRewardIndex: bigint
  /**
   * Market rules: timestamp (ms) of the last `collect_reward`.
   * Vault-native rules: timestamp (ms) the index was last advanced.
   */
  lastHarvestAt: number
  /** true = funded by admin deposits into the vault, false = harvested from the underlying market. */
  isVaultNative: boolean
  /** Vault-native emission per millisecond, RAY (1e27) scaled. Always 0 for market rules. */
  rewardRate: bigint
  /** Disabled rules stop harvesting/emitting but keep their index so users can still claim. */
  isActive: boolean
  /** Vault-native reward budget deposited by the admin. Always 0 for market rules. */
  totalRewardDeposited: bigint
  /** Part of the budget already handed out through index growth. Always 0 for market rules. */
  totalRewardDistributed: bigint
}

/**
 * Reads all reward rules of a NAVI vault straight from the vault object.
 *
 * Includes inactive (soft-deleted) rules, since users may still have unclaimed
 * rewards accrued under them — filter on `isActive` when listing live incentives.
 */
export const getVaultInfo = withCache(
  withSingleton(
    async (
      vault: Vault,
      options?: Partial<
        {
          client: SuiGrpcClient
        } & CacheOption
      >
    ): Promise<VaultInfo> => {
      checkVault(vault)
      const client = getSuiClient(options?.client)

      const { object } = await client.getObject({
        objectId: vault.id,
        include: { content: true }
      })

      const parsed = VaultStruct.parse(Uint8Array.from(object.content))

      return parsed
    }
  )
)

export async function getVaultDefaultPool(
  vault: Vault,
  options?: {
    client?: SuiGrpcClient
  }
) {
  checkVault(vault)
  const vaultInfo = await getVaultInfo(vault, {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const defaultMarket = normalizeSuiAddress(vaultInfo.default_market)
  const pools = await getPools({
    pools: [defaultMarket],
    cacheTime: DEFAULT_CACHE_TIME
  })
  const defaultPool = pools.find(
    (pool) => normalizeSuiAddress(pool.contract.pool) === defaultMarket
  )
  if (!defaultPool) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'default pool was not found', {
      defaultMarket
    })
  }
  return defaultPool
}

export async function getVaultRewardRules(
  vault: Vault,
  options?: {
    client?: SuiGrpcClient
  }
) {
  const vaultInfo = await getVaultInfo(vault, {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return vaultInfo.reward_rules.map((rule, index) => {
    const naviPoolId = normalizeSuiAddress(rule.navi_pool_id)
    return {
      ruleIndex: index,
      ruleKey: `${naviPoolId.slice(2)}|${rule.reward_coin_type}`,
      naviPoolId,
      rewardCoinType: normalizeStructTag(rule.reward_coin_type),
      incentiveRuleId: normalizeSuiAddress(rule.incentive_rule_id),
      vaultRewardIndex: BigInt(rule.vault_reward_index),
      lastHarvestAt: Number(rule.last_harvest_at),
      isVaultNative: rule.is_vault_native,
      rewardRate: BigInt(rule.reward_rate),
      isActive: rule.is_active,
      totalRewardDeposited: BigInt(rule.total_reward_deposited),
      totalRewardDistributed: BigInt(rule.total_reward_distributed)
    }
  })
}
