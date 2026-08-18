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

export type WithdrawTarget =
  | {
    kind: 'amount'
    amount: HumanAmount
  }
  | {
    kind: 'shares'
    shares: IntegerString | TransactionResult
  }
  | {
    kind: 'all'
  }

export interface UserModule {
  getPositions(owner: string, options?: GetPositionsOptions): Promise<VaultUserPosition[]>

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
    request: PendingRequest
  ): Promise<TransactionResult>

  cancelWithdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    request: PendingRequest
  ): Promise<TransactionResult>

  claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string
  ): Promise<TransactionResult>
}

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
  deposit?: {
    amount: string
  }
  withdraw?: {
    shares: string
  }
}