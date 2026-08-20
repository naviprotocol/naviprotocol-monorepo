import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import type { HumanAmount, IntegerString, VaultApp } from '../types'
import type { VaultIdentifier } from '../vaults'
import type { DepositPTBOptions, WithdrawPTBOptions } from './options'

export interface VaultUserPosition {
  vaultId: string
  owner: string
  shares: IntegerString
  amount: HumanAmount
  amountUsd?: number
}

export interface GetPositionsOptions {
  app?: VaultApp[]
  vaults?: VaultIdentifier[]
}

/**
 * A claimable reward, as reported by {@link UserModule.getRewards}.
 *
 * Rewards accrue per receipt, not per owner: a holder with several positions in one vault
 * has one entry per receipt and reward coin.
 */
export interface VaultReward {
  vaultId: string
  owner: string
  receiptId: string
  rewardCoinType: string
  /** Claimable amount in the reward coin's smallest unit. */
  claimable: IntegerString
}

export type WithdrawTarget =
  | { kind: 'amount'; amount: HumanAmount }
  | { kind: 'shares'; shares: IntegerString | TransactionResult }
  | { kind: 'all' }

export interface GetPendingRequestsOptions {
  app?: VaultApp[]
  vaults?: VaultIdentifier[]
  type?: 'deposit' | 'withdraw'
}

export interface PendingRequest {
  requestId: string
  vaultId: string
  owner: string
  type: 'deposit' | 'withdraw'
  receiptId: string
  requestTime: number
  deposit?: { amount: string }
  withdraw?: { shares: string }
}

export interface UserModule {
  getPositions(owner: string, options?: GetPositionsOptions): Promise<VaultUserPosition[]>

  getPendingRequests(owner: string, options?: GetPendingRequestsOptions): Promise<PendingRequest[]>

  /** Claimable rewards for one vault. Filter the result before passing it to {@link claimRewardsPTB}. */
  getRewards(vault: VaultIdentifier, owner: string): Promise<VaultReward[]>

  depositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    amount: HumanAmount,
    options?: DepositPTBOptions
  ): Promise<TransactionResult>

  withdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
  ): Promise<TransactionResult>

  cancelDepositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult>

  cancelWithdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult>

  claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    rewards: VaultReward[]
  ): Promise<TransactionResult>
}
