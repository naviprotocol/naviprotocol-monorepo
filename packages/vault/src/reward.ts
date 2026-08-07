/**
 * Vault Rewards
 *
 * Rewards reach a holder in two hops. `collect_reward` harvests from NAVI's incentive
 * into the vault's reward bag and advances the rule's index; `claim_reward` pays a
 * holder out of that bag according to their share of the index growth. Vault-native
 * rules skip the first hop — they are settled from a per-millisecond rate inside the
 * vault.
 *
 * @module VaultReward
 */

import { Transaction } from '@mysten/sui/transactions'
import { normalizeCoinType } from '@naviprotocol/lending'
import { getVaultConfig, resolveVault } from './config'
import { getVaultLayout, selectHarvestableRules } from './layout'
import {
  appendCollectRewardsPTB,
  claimRewardPTB,
  createTxContext,
  getClaimableRewardPTB
} from './ptb'
import type {
  ClaimRewardArgs,
  VaultBuildOptions,
  VaultIdentifier,
  VaultLayout,
  VaultReadOptions
} from './types'
import { decode, decodeOne, simulate, tryDecodeCoinBalance } from './utils'

/** Distinct reward coin types a vault currently pays. */
export async function getRewardCoinTypes(
  identifier: VaultIdentifier,
  options?: VaultReadOptions & { layout?: VaultLayout }
): Promise<string[]> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(identifier, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  return [...new Set(layout.rules.filter((rule) => rule.isActive).map((r) => r.rewardCoinType))]
}

/**
 * Reads the contract's recorded claimable amount.
 *
 * Fast but understated, in two independent ways: a rule's index only advances when it is
 * harvested, and a holder's accrued total only advances when that holder interacts with
 * the vault. A holder who has not deposited, withdrawn or claimed since the last index
 * growth reads low. Use {@link previewClaimReward} when the figure has to be right.
 */
export async function getRecordedClaimableReward(
  args: { vault: VaultIdentifier; receiptId: string; rewardCoinType: string },
  options?: VaultReadOptions
): Promise<bigint> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const ctx = createTxContext(config, descriptor)

  const tx = new Transaction()
  getClaimableRewardPTB(tx, ctx, {
    receiptId: args.receiptId,
    rewardCoinType: args.rewardCoinType
  })

  const results = await simulate(tx, options)
  return decodeOne(results, 0, decode.u64, 'get_user_claimable_reward_amount')
}

/**
 * Simulates harvest-then-claim and reports what the holder would actually receive.
 *
 * This resolves both lags in the recorded figure: harvesting advances the rule indices,
 * and `claim_reward` settles the holder's accrued total as part of the same block. No
 * view function can report this, because resolving the second lag requires mutating the
 * holder's state.
 */
export async function previewClaimReward(
  args: ClaimRewardArgs,
  options?: VaultBuildOptions
): Promise<bigint> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)
  const rewardCoinType = normalizeCoinType(args.rewardCoinType)

  const harvestable = selectHarvestableRules(layout, descriptor).filter(
    (rule) => normalizeCoinType(rule.rewardCoinType) === rewardCoinType
  )

  const tx = new Transaction()
  appendCollectRewardsPTB(tx, ctx, harvestable)
  claimRewardPTB(tx, ctx, {
    receipt: tx.object(args.receiptId),
    rewardCoinType: args.rewardCoinType
  })

  const results = await simulate(tx, { ...options, sender: args.sender })
  const claim = results[results.length - 1]
  return tryDecodeCoinBalance(claim?.[0]) ?? 0n
}

/**
 * Builds a reward claim.
 *
 * Harvests the rules paying this coin first so the claim picks up the latest protocol
 * rewards, then claims. One call settles every rule paying `rewardCoinType`.
 *
 * `claim_reward` returns a zero-valued coin rather than aborting when nothing is
 * claimable, and that object still has to be consumed — which is why it is worth
 * checking {@link previewClaimReward} first rather than routinely building claims that
 * deposit empty coin objects in the holder's account.
 */
export async function buildClaimRewardTx(
  args: ClaimRewardArgs,
  options?: VaultBuildOptions & { harvestFirst?: boolean }
): Promise<Transaction> {
  const config = await getVaultConfig(options)
  const descriptor = resolveVault(args.vault, config)
  const layout = options?.layout ?? (await getVaultLayout(descriptor, options))
  const ctx = createTxContext(config, descriptor)
  const rewardCoinType = normalizeCoinType(args.rewardCoinType)

  const tx = new Transaction()
  tx.setSenderIfNotSet(args.sender)

  if (options?.harvestFirst ?? true) {
    const harvestable = selectHarvestableRules(layout, descriptor).filter(
      (rule) => normalizeCoinType(rule.rewardCoinType) === rewardCoinType
    )
    appendCollectRewardsPTB(tx, ctx, harvestable)
  }

  const coin = claimRewardPTB(tx, ctx, {
    receipt: tx.object(args.receiptId),
    rewardCoinType: args.rewardCoinType
  })
  tx.transferObjects([coin], tx.pure.address(args.sender))

  return tx
}
