import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import type { IntegerString, VaultApp } from '../types'
import type { VaultIdentifier } from '../vaults'
import type { DepositPTBOptions, WithdrawPTBOptions } from './options'

/**
 * A holder's position in one vault, as the backend reports it.
 *
 * Display values. They arrive as JSON numbers, so they are not exact past
 * `Number.MAX_SAFE_INTEGER` and are typed as numbers rather than as integer strings that
 * would imply otherwise. Anything that has to be exact — the share count a Volo withdrawal
 * burns, the amount a NAVI withdrawal redeems — is read on chain instead.
 */
export interface VaultUserPosition {
  vaultId: string
  owner: string
  /** Share balance, in the vault's share unit. */
  shares: number
  /** Value of those shares in the vault's principal coin. */
  amount: number
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
  | { kind: 'amount'; amount: IntegerString }
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
    amount: IntegerString,
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
