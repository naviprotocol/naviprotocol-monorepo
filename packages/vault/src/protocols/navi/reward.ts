import { Vault } from '../../types'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { getVaultReceipts } from './receipt'
import { checkVault } from './utils'

/** One receipt's reward position for a single coin type, ready to pass to {@link claimRewardsPTB}. */
export type VaultReward = {
  /** Reward coin type, normalized to a `0x`-prefixed struct tag. */
  rewardCoinType: string
  /** Receipt object id this reward is credited to. */
  receipt: string
  /** Sum of `claimable` across every rule sharing `rewardCoinType` on this receipt. */
  claimable: bigint
  /** Sum of `claimed` across every rule sharing `rewardCoinType` on this receipt. */
  claimed: bigint
  vault: Vault
}

/**
 * Lists an owner's claimable/claimed rewards for a NAVI vault, one entry per
 * (receipt, reward coin type) pair — the granularity {@link claimRewardsPTB} claims at.
 *
 * Aggregates {@link getVaultReceipts}' per-rule reward entries by coin type, since claiming
 * happens per reward coin, not per rule.
 *
 * Note that `claimable` here sums only the SETTLED balances (`accrued - claimed`) and
 * excludes each rule's unsettled `pending`, while an actual `claim_reward` settles first and
 * therefore pays out `claimable + pending`. Entries with a zero `claimable` may still be
 * worth claiming, and are returned rather than filtered out.
 *
 * @param vault - The NAVI vault to read rewards for. Must carry `vault.navi` config
 * @param owner - Sui address holding the receipts
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<VaultReward[]> - One entry per (receipt, reward coin type) pair, ready to
 *          pass to `claimRewardsPTB`. Empty when the owner holds no receipts
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a NAVI vault
 */
export async function getVaultRewards(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
  }
) {
  checkVault(vault)
  const receipts = await getVaultReceipts(vault, owner, options)
  const rewards = {} as Record<string, VaultReward>
  receipts.forEach((receipt) => {
    receipt.rewards.forEach((reward) => {
      const key = `${reward.rewardCoinType}_${receipt.id}`
      if (!rewards[key]) {
        rewards[key] = {
          rewardCoinType: reward.rewardCoinType,
          receipt: receipt.id,
          claimable: 0n,
          claimed: 0n,
          vault
        }
      }
      rewards[key].claimable += reward.claimable
      rewards[key].claimed += reward.claimed
    })
  })
  return Object.values(rewards)
}
