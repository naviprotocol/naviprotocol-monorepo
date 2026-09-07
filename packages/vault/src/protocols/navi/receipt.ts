import { bcs, type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { DEFAULT_CACHE_TIME } from '@naviprotocol/lending'
import { Vault } from '../../types'
import { U64_MAX } from '../../config'
import { getSuiClient } from '../../utils'
import { getVaultInfo, getVaultRewardRules, VaultRewardRule } from './vault'

export const receiptType = `0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c::navi_vault::Receipt`

export const ReceiptStruct: BcsType<
  {
    id: string
    vaultId: string
  },
  { id: string | Uint8Array; vaultId: string | Uint8Array }
> = bcs.struct('Receipt', {
  id: bcs.Address,
  vaultId: bcs.Address
})

/** `VecMap<String, u256>`, the shape of every reward ledger inside `UserState`. */
const RewardAmountMap = bcs.struct('VecMap', {
  contents: bcs.vector(
    bcs.struct('Entry', {
      key: bcs.string(),
      value: bcs.u256()
    })
  )
})

/**
 * `0x2::dynamic_field::Field<address, navi_vault::UserState>`.
 *
 * Shares are not stored in the Receipt object: the vault keeps them in
 * `Vault.user_states: Table<address, UserState>`, keyed by the receipt's object address.
 * A `Table` entry is a child object hanging off the table's UID, so each entry can be read
 * — and batched — as a plain object once its id is derived from the receipt id.
 */
const UserStateFieldStruct = bcs.struct('Field', {
  id: bcs.Address,
  /** The table key: the receipt's object address. */
  name: bcs.Address,
  value: bcs.struct('UserState', {
    shares: bcs.u64(),
    reward_indices: RewardAmountMap,
    reward_total: RewardAmountMap,
    reward_claimed: RewardAmountMap
  })
})

/** RAY, the 1e27 scale every reward index is expressed in. */
const RAY = 10n ** 27n

/** One receipt's reward position under a single reward rule key. */
export type VaultReceiptReward = {
  /** `<pool>|<coinType>` — the key the vault's per-user reward ledgers are indexed by. */
  ruleKey: string
  /** Reward coin type, normalized to a `0x`-prefixed struct tag. */
  rewardCoinType: string
  /** NAVI lending pool of the rule. `0x0…0` for vault-native rules. */
  naviPoolId: string
  /** The receipt's index snapshot, i.e. how far its rewards have been settled. */
  userIndex: bigint
  /** Rewards already settled into the ledger (`reward_total`). */
  accrued: bigint
  /** Rewards already paid out (`reward_claimed`). */
  claimed: bigint
  /** `accrued - claimed`: what `get_user_claimable_reward_amount` would report right now. */
  claimable: bigint
  /**
   * Rewards earned but not yet settled, i.e. what the next interaction would add:
   * `shares * (rule index - userIndex) / RAY`, floored exactly as the contract does.
   *
   * A `claim_reward` settles first and then pays, so it hands out `claimable + pending`
   * (bounded by the vault's collected balance for that coin).
   */
  pending: bigint
}

/** A receipt held by an owner, together with the shares and rewards the vault credits to it. */
export type VaultReceipt = {
  /** Receipt object id. */
  id: string
  /**
   * Shares held under this receipt. `0n` when the vault has no `user_states` entry for it,
   * which is the case for a freshly created receipt and for one that was fully withdrawn
   * (the contract never deletes receipts or their state).
   */
  shares: bigint
  /**
   * One entry per reward rule key, in on-chain rule order. Always covers every rule of the
   * vault, including disabled ones (their `claimable` stays claimable) and rules the receipt
   * has never touched (all zeros).
   *
   * Claiming happens per reward coin type, not per rule: sum the entries that share a
   * `rewardCoinType` to get what one `claim_reward` would pay.
   */
  rewards: VaultReceiptReward[]
}

/**
 * Parsed `VecMap<String, u256>` entries as a lookup.
 *
 * @param entries - The decoded `contents` vector of a reward ledger
 * @returns Rule key to amount. Later duplicates win, matching `VecMap` insertion semantics
 */
function toAmountMap(entries: { key: string; value: string }[]): Map<string, bigint> {
  return new Map(entries.map((entry) => [entry.key, BigInt(entry.value)]))
}

/**
 * Replays `update_user_reward_state_internal` for one receipt.
 *
 * Walks the rules in on-chain order and carries a running index per rule key, because two rules
 * sharing a key settle one after the other against the same ledger. Accrual is floor division
 * (`shares * diff / RAY`), not `ray_mul` — the contract does not round half up here.
 *
 * @param rules - The vault's reward rules in on-chain order; order is significant
 * @param shares - The receipt's share balance, the multiplier for pending accrual
 * @param indices - Per-rule-key index snapshots from the receipt's `reward_indices` ledger
 * @param totals - Per-rule-key settled amounts from the receipt's `reward_total` ledger
 * @param claimed - Per-rule-key paid-out amounts from the receipt's `reward_claimed` ledger
 * @returns One entry per distinct rule key, in first-seen rule order
 */
function buildRewards(
  rules: VaultRewardRule[],
  shares: bigint,
  indices: Map<string, bigint>,
  totals: Map<string, bigint>,
  claimed: Map<string, bigint>
): VaultReceiptReward[] {
  const rewards: VaultReceiptReward[] = []
  const byKey = new Map<string, VaultReceiptReward>()
  const runningIndex = new Map<string, bigint>()

  for (const rule of rules) {
    const userIndex = indices.get(rule.ruleKey) ?? 0n
    const lastIndex = runningIndex.get(rule.ruleKey) ?? userIndex
    runningIndex.set(rule.ruleKey, rule.vaultRewardIndex)

    const pending =
      rule.vaultRewardIndex >= lastIndex ? (shares * (rule.vaultRewardIndex - lastIndex)) / RAY : 0n

    const existing = byKey.get(rule.ruleKey)
    if (existing) {
      existing.pending += pending
      continue
    }

    const accrued = totals.get(rule.ruleKey) ?? 0n
    const paid = claimed.get(rule.ruleKey) ?? 0n
    const reward: VaultReceiptReward = {
      ruleKey: rule.ruleKey,
      rewardCoinType: rule.rewardCoinType,
      naviPoolId: rule.naviPoolId,
      userIndex,
      accrued,
      claimed: paid,
      claimable: accrued > paid ? accrued - paid : 0n,
      pending
    }
    byKey.set(rule.ruleKey, reward)
    rewards.push(reward)
  }

  return rewards
}

/**
 * Lists an owner's receipts for a vault, each with its share balance and reward position.
 *
 * Everything comes from the `user_states` table rather than from one `get_user_shares` /
 * `get_user_claimable_reward_amount` call per receipt: the table entry id is derived locally
 * from the receipt id, so any number of receipts costs a single batched read, and each entry
 * carries the shares and all three reward ledgers at once.
 *
 * Reward figures inherit the contract's staleness: market rules only advance on
 * `collect_reward`, so rewards sitting unharvested in the underlying protocol are invisible
 * here, and a vault-native rule's index only advances when someone interacts with the vault.
 *
 * @param vault - The NAVI vault to read receipts for. Must carry `vault.navi` config
 * @param owner - Sui address holding the receipts. Receipts transferred away or deposited
 *                elsewhere as a defi asset drop out of this list
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<VaultReceipt[]> - One entry per owned receipt for this vault, each with its
 *          shares and full per-rule reward position. Empty when the owner holds none
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault
 */
export async function getVaultReceipts(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
  }
): Promise<VaultReceipt[]> {
  const vaultInfo = await getVaultInfo(vault, {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const rules = await getVaultRewardRules(vault, options)
  const client = getSuiClient(options?.client)
  const vaultAddress = normalizeSuiAddress(vault.id)

  const found: string[] = []
  let cursor: string | null | undefined

  do {
    const page = await client.listOwnedObjects({
      owner,
      type: receiptType,
      cursor,
      include: { content: true }
    })

    for (const object of page.objects) {
      if (!object.content) continue
      const parsed = ReceiptStruct.parse(Uint8Array.from(object.content))
      if (normalizeSuiAddress(parsed.vaultId) !== vaultAddress) continue
      found.push(normalizeSuiAddress(object.objectId))
    }

    cursor = page.hasNextPage ? (page.cursor === cursor ? null : page.cursor) : null
  } while (cursor)

  if (found.length === 0) {
    return []
  }

  const userStatesTable = normalizeSuiAddress(vaultInfo.user_states.id)
  const fieldIds = found.map((receiptId) =>
    deriveDynamicFieldID(userStatesTable, 'address', bcs.Address.serialize(receiptId).toBytes())
  )

  // Batched, order-preserving, and chunked at 50 by the client. A receipt with no entry yet
  // comes back as an Error in its own slot instead of failing the whole read.
  const { objects } = await client.getObjects({
    objectIds: fieldIds,
    include: { content: true }
  })

  const receipts = found.map((id, index) => {
    const object = objects[index]
    if (object instanceof Error || !object?.content) {
      return {
        id,
        shares: 0n,
        rewards: buildRewards(rules, 0n, new Map(), new Map(), new Map())
      }
    }
    const state = UserStateFieldStruct.parse(Uint8Array.from(object.content)).value
    const shares = BigInt(state.shares)
    return {
      id,
      shares,
      rewards: buildRewards(
        rules,
        shares,
        toAmountMap(state.reward_indices.contents),
        toAmountMap(state.reward_total.contents),
        toAmountMap(state.reward_claimed.contents)
      )
    }
  })

  return receipts
}

/** One `navi_vault::withdraw` call to build: `amount` is in base units, `U64_MAX` drains the receipt. */
export type ReceiptWithdrawPlan = {
  id: string
  amount: bigint
}

/**
 * Plans per-receipt withdraw calls in ASSET units.
 *
 * `navi_vault::withdraw` takes an underlying asset amount (u64), not a share count, and
 * treats `U64_MAX` as "withdraw everything on this receipt". Receipts consumed in full
 * therefore get the `U64_MAX` sentinel — the contract computes the exact payout at
 * execution time — and only the final partial receipt carries an explicit amount, sized
 * with floor division so it can never exceed the receipt's redeemable value.
 *
 * Receipts are consumed smallest-first, which keeps the number of calls down by retiring
 * dust receipts before touching a large one. Zero-share receipts are skipped.
 *
 * @param receipts - The owner's receipts for the vault, as returned by {@link getVaultReceipts}.
 *        Not mutated; filtered and sorted internally
 * @param amount - Requested asset amount in base units; `U64_MAX` withdraws everything
 * @param totalAssets - On-chain `Vault.total_assets`, used only to estimate each receipt's
 *        redeemable value for plan sizing
 * @param totalShares - On-chain `Vault.total_shares`, the denominator of that same estimate.
 *        Must be non-zero unless `amount` is `U64_MAX`
 * @returns The plan plus the `shortfall` still uncovered after consuming every receipt
 *          (always `0n` for the withdraw-everything sentinel). Callers must treat a
 *          non-zero shortfall (or an empty plan) as an insufficient-balance error
 *          rather than silently withdrawing less than requested
 */
export function planReceiptWithdrawByAmount(
  receipts: VaultReceipt[],
  amount: bigint,
  totalAssets: bigint,
  totalShares: bigint
): { plans: ReceiptWithdrawPlan[]; shortfall: bigint } {
  const available = [...receipts]
    .filter((receipt) => receipt.shares > 0n)
    .sort((a, b) => (a.shares < b.shares ? -1 : a.shares > b.shares ? 1 : 0))

  if (amount === U64_MAX) {
    return {
      plans: available.map((receipt) => ({ id: receipt.id, amount: U64_MAX })),
      shortfall: 0n
    }
  }

  const plans: ReceiptWithdrawPlan[] = []
  let remaining = amount

  for (const receipt of available) {
    if (remaining === 0n) break
    const value = (receipt.shares * totalAssets) / totalShares
    if (value === 0n) continue
    if (remaining >= value) {
      plans.push({ id: receipt.id, amount: U64_MAX })
      remaining -= value
    } else {
      plans.push({ id: receipt.id, amount: remaining })
      remaining = 0n
    }
  }

  return { plans, shortfall: remaining }
}
