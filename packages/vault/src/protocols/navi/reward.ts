import { Vault } from '../../types'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { getVaultReceipts } from './receipt'
import { checkVault } from './utils'

export type VaultReward = {
  rewardCoinType: string
  receipt: string
  claimable: bigint
  claimed: bigint
  vault: Vault
}

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
