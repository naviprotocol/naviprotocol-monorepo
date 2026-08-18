import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import type { HumanAmount, IntegerString } from '../types'
import type { NAVILendingVault, Vault, VoloVault } from '../vaults'
import type { DepositPTBOptions, WithdrawPTBOptions, WithdrawTarget } from '../user'

export interface ProtocolPTB<TVault extends Vault> {
  depositPTB(
    tx: Transaction,
    vault: TVault,
    owner: string,
    amount: HumanAmount,
    options?: DepositPTBOptions
  ): Promise<TransactionResult>

  withdrawPTB(
    tx: Transaction,
    vault: TVault,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
  ): Promise<TransactionResult>

  cancelDepositPTB(
    tx: Transaction,
    vault: TVault,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult>

  cancelWithdrawPTB(
    tx: Transaction,
    vault: TVault,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult>

  claimRewardsPTB(tx: Transaction, vault: TVault, owner: string): Promise<TransactionResult>
}

export interface ProtocolRegistry {
  'navi-lending': ProtocolPTB<NAVILendingVault>
  'volo-vault': ProtocolPTB<VoloVault>
}
