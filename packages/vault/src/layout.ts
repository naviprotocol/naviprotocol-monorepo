/**
 * Vault Layout Discovery
 *
 * Reads live vault state — market membership, reward rules, fees, pause state — from
 * chain, and locates a holder's receipts.
 *
 * Results must NOT be cached across transactions. `add_market` registers a market with
 * `lastSyncAtMs = 0n` and `set_loss` resets an existing one, so a transaction built from
 * a stale layout aborts with `E_MARKET_NOT_READ` (10006). Read the layout while building
 * the transaction that uses it.
 *
 * @command budget: two simulated round trips — one to learn the market and rule counts,
 * one to read them.
 *
 * @module VaultLayout
 */

import { Transaction } from '@mysten/sui/transactions'
import { getVaultConfig, isZeroAddress, resolveVault, VAULT_MODULE } from './config'
import { NaviVaultError, throwVaultError } from './errors'
import { ReceiptStruct } from './bcs'
import type {
  HarvestableRule,
  VaultDescriptor,
  VaultIdentifier,
  VaultLayout,
  VaultReadOptions,
  VaultReceipt
} from './types'
import { MarketStatus } from './types'
import {
  decode,
  decodeCommand,
  decodeOne,
  isSameAddress,
  normalizeAddress,
  normalizeMoveType,
  simulate
} from './utils'

/** Number of commands emitted per market by the layout read block. */
const COMMANDS_PER_MARKET = 3

/**
 * Return schemas, taken from the contract signatures in `sources/navi_vault.move`.
 * The simulation response carries no type information, so these are the only thing
 * defining how the bytes are read.
 */
const SCHEMA = {
  /** `(cap, penalty, loss, status, last_sync_at, storage, asset_id, incentive_v3, incentive_v2)` */
  marketConfig: [
    decode.u64,
    decode.u64,
    decode.u64,
    decode.u8,
    decode.u64,
    decode.address,
    decode.u8,
    decode.address,
    decode.address
  ],
  /**
   * `(navi_pool_id, reward_coin_type, incentive_rule_id, vault_reward_index,
   *   last_harvest_at, is_vault_native, reward_rate, is_active,
   *   total_reward_deposited, total_reward_distributed)`
   */
  ruleInfo: [
    decode.address,
    decode.string,
    decode.address,
    decode.u256,
    decode.u64,
    decode.bool,
    decode.u256,
    decode.bool,
    decode.u64,
    decode.u64
  ]
} as const

function target(packageId: string, fn: string): `${string}::${string}::${string}` {
  return `${packageId}::${VAULT_MODULE}::${fn}`
}

function marketStatusFromDiscriminant(value: number): MarketStatus {
  if (value === MarketStatus.Active) return MarketStatus.Active
  if (value === MarketStatus.Disabled) return MarketStatus.Disabled
  throw new Error(`Unknown market status discriminant: ${value}`)
}

/**
 * Reads the vault's live layout.
 *
 * @param identifier - Vault object id, config key, or descriptor.
 */
export async function getVaultLayout(
  identifier: VaultIdentifier,
  options?: VaultReadOptions
): Promise<VaultLayout> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(identifier, config)
  const { packageId } = config.package
  const typeArgs = [descriptor.coinType]

  // Round 1: scalars, plus the counts that size round 2.
  const counts = new Transaction()
  for (const fn of [
    'num_markets',
    'num_reward_rules',
    'get_vault_default_market',
    'is_paused',
    'version',
    'get_vault_cap',
    'get_management_fee',
    'get_performance_fee',
    'get_idle_balance',
    'get_total_shares'
  ]) {
    counts.moveCall({
      target: target(packageId, fn),
      typeArguments: typeArgs,
      arguments: [counts.object(descriptor.vault)]
    })
  }

  const scalars = await simulate(counts, options)
  const marketCount = Number(decodeOne(scalars, 0, decode.u64, 'num_markets'))
  const ruleCount = Number(decodeOne(scalars, 1, decode.u64, 'num_reward_rules'))

  const layout: VaultLayout = {
    markets: [],
    rules: [],
    defaultMarket: normalizeAddress(
      decodeOne(scalars, 2, decode.address, 'get_vault_default_market')
    ),
    paused: decodeOne(scalars, 3, decode.bool, 'is_paused'),
    version: decodeOne(scalars, 4, decode.u64, 'version'),
    vaultCap: decodeOne(scalars, 5, decode.u64, 'get_vault_cap'),
    managementFee: decodeOne(scalars, 6, decode.u64, 'get_management_fee'),
    performanceFee: decodeOne(scalars, 7, decode.u64, 'get_performance_fee'),
    idleBalance: decodeOne(scalars, 8, decode.u64, 'get_idle_balance'),
    totalShares: decodeOne(scalars, 9, decode.u64, 'get_total_shares')
  }

  if (marketCount === 0 && ruleCount === 0) {
    return layout
  }

  // Round 2: per-market config, then per-rule info. The pool address returned by
  // get_market_address_at_index feeds the two reads that follow it, so the whole
  // enumeration fits in one block.
  const details = new Transaction()
  for (let index = 0; index < marketCount; index += 1) {
    const address = details.moveCall({
      target: target(packageId, 'get_market_address_at_index'),
      typeArguments: typeArgs,
      arguments: [details.object(descriptor.vault), details.pure.u64(index)]
    })
    details.moveCall({
      target: target(packageId, 'get_market_config'),
      typeArguments: typeArgs,
      arguments: [details.object(descriptor.vault), address]
    })
    details.moveCall({
      target: target(packageId, 'get_market_info'),
      typeArguments: typeArgs,
      arguments: [details.object(descriptor.vault), address]
    })
  }
  for (let index = 0; index < ruleCount; index += 1) {
    details.moveCall({
      target: target(packageId, 'get_rule_info'),
      typeArguments: typeArgs,
      arguments: [details.object(descriptor.vault), details.pure.u64(index)]
    })
  }

  const results = await simulate(details, options)

  for (let index = 0; index < marketCount; index += 1) {
    const base = index * COMMANDS_PER_MARKET
    const poolId = normalizeAddress(
      decodeOne(results, base, decode.address, `market[${index}] address`)
    )
    const [
      cap,
      penalty,
      loss,
      status,
      lastSyncAtMs,
      storageId,
      assetId,
      incentiveV3Id,
      incentiveV2Id
    ] = decodeCommand(results, base + 1, SCHEMA.marketConfig, `market[${index}] config`)

    layout.markets.push({
      poolId,
      cap,
      penalty,
      loss,
      status: marketStatusFromDiscriminant(status),
      lastSyncAtMs,
      storageId: normalizeAddress(storageId),
      assetId,
      incentiveV3Id: normalizeAddress(incentiveV3Id),
      incentiveV2Id: normalizeAddress(incentiveV2Id),
      currentBalance: decodeOne(results, base + 2, decode.u64, `market[${index}] balance`)
    })
  }

  const ruleBase = marketCount * COMMANDS_PER_MARKET
  for (let index = 0; index < ruleCount; index += 1) {
    const [
      naviPoolId,
      rewardCoinType,
      incentiveRuleId,
      vaultRewardIndex,
      lastHarvestAtMs,
      isVaultNative,
      rewardRate,
      isActive,
      totalRewardDeposited,
      totalRewardDistributed
    ] = decodeCommand(results, ruleBase + index, SCHEMA.ruleInfo, `rule[${index}]`)

    layout.rules.push({
      index,
      naviPoolId: normalizeAddress(naviPoolId),
      // type_name renders addresses without the 0x prefix; unprefixed it is rejected
      // as a type argument by the transport before it ever reaches the VM.
      rewardCoinType: normalizeMoveType(rewardCoinType),
      incentiveRuleId: normalizeAddress(incentiveRuleId),
      vaultRewardIndex,
      lastHarvestAtMs,
      isVaultNative,
      rewardRate,
      isActive,
      totalRewardDeposited,
      totalRewardDistributed
    })
  }

  return layout
}

/**
 * Selects the rules that must be harvested in the same block as a deposit or withdrawal
 * — active market rules only; vault-native rules settle internally and are exempt.
 *
 * Resolves each rule's `RewardFund`, `Storage` and `incentive_v3` objects from
 * configuration, since they are not recorded in vault state. A rule whose fund cannot be
 * resolved is fatal, not skippable: leaving it unharvested makes the following deposit or
 * withdrawal abort with `E_REWARDS_NOT_COLLECTED`.
 */
export function selectHarvestableRules(
  layout: VaultLayout,
  descriptor: VaultDescriptor
): HarvestableRule[] {
  const harvestable = layout.rules.filter((rule) => rule.isActive && !rule.isVaultNative)

  return harvestable.map((rule) => {
    const configured = descriptor.rewardRules.find((candidate) => candidate.index === rule.index)
    const rewardFund = configured?.rewardFund
    const storageId = configured?.storage
    const incentiveV3Id = configured?.incentiveV3

    if (!rewardFund || !storageId || !incentiveV3Id) {
      throw new NaviVaultError({
        code: 10007,
        name: 'E_REWARDS_NOT_COLLECTED',
        kind: 'config',
        message:
          `Reward rule ${rule.index} (${rule.rewardCoinType}) is active on chain but has no ` +
          `RewardFund/Storage/incentive_v3 in configuration. RewardFund objects live on the ` +
          `lending side and are not discoverable from vault state — add them to the vault ` +
          `config, otherwise every deposit and withdrawal on this vault will abort.`,
        raw: `rule ${rule.index}`
      })
    }

    return { ...rule, rewardFund, storageId, incentiveV3Id }
  })
}

/**
 * Cross-checks the live layout against configuration and returns human-readable
 * discrepancies.
 *
 * A non-empty result means the bundled or supplied config has drifted from chain and
 * transactions built from it may abort. Markets are compared by pool id; a market present
 * on chain but absent from config is the case that breaks deposits, because its
 * `Storage` object cannot be resolved for the required synchronization.
 */
export function diffLayoutAgainstConfig(
  layout: VaultLayout,
  descriptor: VaultDescriptor
): string[] {
  const issues: string[] = []

  for (const market of layout.markets) {
    const configured = descriptor.markets.find((candidate) =>
      isSameAddress(candidate.pool, market.poolId)
    )
    if (!configured) {
      issues.push(`Market ${market.poolId} is registered on chain but missing from configuration.`)
      continue
    }
    if (!isSameAddress(configured.storage, market.storageId)) {
      issues.push(
        `Market ${configured.name}: configured Storage ${configured.storage} does not match ` +
          `on-chain ${market.storageId}.`
      )
    }
    if (!isSameAddress(configured.incentiveV3, market.incentiveV3Id)) {
      issues.push(
        `Market ${configured.name}: configured incentive_v3 ${configured.incentiveV3} does not ` +
          `match on-chain ${market.incentiveV3Id}.`
      )
    }
    if (configured.assetId !== market.assetId) {
      issues.push(
        `Market ${configured.name}: configured assetId ${configured.assetId} does not match ` +
          `on-chain ${market.assetId}.`
      )
    }
  }

  for (const configured of descriptor.markets) {
    if (!layout.markets.some((market) => isSameAddress(market.poolId, configured.pool))) {
      issues.push(
        `Market ${configured.name} (${configured.pool}) is in configuration but not registered ` +
          `on chain.`
      )
    }
  }

  const configuredDefault = descriptor.markets.find((market) => market.isDefault)
  if (
    !isZeroAddress(layout.defaultMarket) &&
    configuredDefault &&
    !isSameAddress(configuredDefault.pool, layout.defaultMarket)
  ) {
    issues.push(
      `Default market changed: configuration says ${configuredDefault.name} ` +
        `(${configuredDefault.pool}), chain says ${layout.defaultMarket}.`
    )
  }

  for (const rule of layout.rules) {
    if (!rule.isActive || rule.isVaultNative) continue
    const configured = descriptor.rewardRules.find((candidate) => candidate.index === rule.index)
    if (!configured?.rewardFund) {
      issues.push(
        `Reward rule ${rule.index} (${rule.rewardCoinType}) is active on chain but has no ` +
          `RewardFund in configuration.`
      )
    }
  }

  return issues
}

/**
 * Lists a holder's positions in one vault.
 *
 * Two properties of `Receipt` make this less direct than it looks. It is not generic, so
 * one type covers every vault and each object's `vault_address` has to be matched
 * individually — this is load-bearing, not defensive: two vaults share `0x2::sui::SUI`
 * and two more share USDC. And the type filter must use the ORIGINAL package id, never
 * the current call target; the wrong one matches nothing and reports no error.
 */
export async function findReceipts(
  owner: string,
  identifier: VaultIdentifier,
  options?: VaultReadOptions
): Promise<VaultReceipt[]> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(identifier, config)
  const receiptType = `${config.package.typePackageId}::${VAULT_MODULE}::Receipt`

  const core = (options?.client as { core?: unknown } | undefined)?.core as
    | {
        listOwnedObjects?(input: unknown): Promise<{
          objects: { objectId: string; content?: Uint8Array | null }[]
          cursor?: string | null
          hasNextPage?: boolean
        }>
      }
    | undefined

  if (typeof core?.listOwnedObjects !== 'function') {
    throw new Error('findReceipts requires a Sui v2 Core-capable client')
  }

  const vaultAddress = normalizeAddress(descriptor.vault)
  const receipts: VaultReceipt[] = []
  let cursor: string | null | undefined

  do {
    let page
    try {
      page = await core.listOwnedObjects({
        owner,
        type: receiptType,
        cursor,
        include: { content: true }
      })
    } catch (error) {
      throwVaultError(error)
    }

    for (const object of page.objects) {
      if (!object.content) continue
      const parsed = ReceiptStruct.parse(Uint8Array.from(object.content))
      if (normalizeAddress(parsed.vault_address) !== vaultAddress) continue
      receipts.push({
        objectId: normalizeAddress(object.objectId),
        vaultAddress
      })
    }

    // Guard the loop rather than trusting hasNextPage alone: a transport that reports
    // another page but returns no cursor, or repeats the one we sent, would otherwise
    // re-fetch the same page forever.
    const nextCursor = page.hasNextPage ? (page.cursor ?? null) : null
    cursor = nextCursor && nextCursor !== cursor ? nextCursor : null
  } while (cursor)

  return receipts
}
