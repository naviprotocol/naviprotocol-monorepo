import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { operationNotSupported } from '../errors'
import type { VaultModuleContext } from '../module-context'
import type { HumanAmount, IntegerString } from '../types'
import type { VaultIdentifier } from '../vaults'
import type { DepositPTBOptions, WithdrawPTBOptions } from './options'
import type { GetPositionsOptions, UserModule, VaultUserPosition, WithdrawTarget, GetPendingRequestsOptions, PendingRequest } from './types'

class DefaultUserModule implements UserModule {
  async getPositions(owner: string, options?: GetPositionsOptions): Promise<VaultUserPosition[]> {
    void owner
    void options
    return operationNotSupported('user.getPositions')
  }

  async getPendingRequests(owner: string, options?: GetPendingRequestsOptions): Promise<PendingRequest[]> {
    void owner
    void options
    return operationNotSupported('user.getPendingRequests')
  }

  async depositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    amount: HumanAmount,
    options?: DepositPTBOptions
  ): Promise<TransactionResult> {
    void tx
    void vault
    void owner
    void amount
    void options
    return operationNotSupported('user.depositPTB')
  }

  async withdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
  ): Promise<TransactionResult> {
    void tx
    void vault
    void owner
    void target
    void options
    return operationNotSupported('user.withdrawPTB')
  }

  async cancelDepositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    request: PendingRequest
  ): Promise<TransactionResult> {
    void tx
    void vault
    void owner
    void request
    return operationNotSupported('user.cancelDepositPTB')
  }

  async cancelWithdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    request: PendingRequest
  ): Promise<TransactionResult> {
    void tx
    void vault
    void owner
    void request
    return operationNotSupported('user.cancelWithdrawPTB')
  }

  async claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string
  ): Promise<TransactionResult> {
    void tx
    void vault
    void owner
    return operationNotSupported('user.claimRewardsPTB')
  }
}

export function createUserModule(context: VaultModuleContext): UserModule {
  void context
  return new DefaultUserModule()
}

export type { DepositPTBOptions, WithdrawPTBOptions } from './options'
export type { GetPositionsOptions, UserModule, VaultUserPosition, WithdrawTarget } from './types'
