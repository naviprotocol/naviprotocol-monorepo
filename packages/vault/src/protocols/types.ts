import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import type { HumanAmount, IntegerString } from '../types'
import type { NAVILendingVault, Vault, VoloVault } from '../vaults'
import type { DepositPTBOptions, VaultReward, WithdrawPTBOptions, WithdrawTarget } from '../user'

/**
 * Per-protocol PTB construction.
 *
 * These are thin wrappers over the contract entrypoints. `sdk.user` resolves a
 * `VaultIdentifier` and dispatches here on `vault.protocol`; operations one protocol does
 * not have throw `OPERATION_NOT_SUPPORTED` rather than being absent from the type.
 *
 * Implementations are built with {@link createProtocolRegistry} so they can reach the
 * client through `VaultModuleContext` — receipt resolution and coin selection both read
 * chain state.
 */
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

  claimRewardsPTB(
    tx: Transaction,
    vault: TVault,
    owner: string,
    rewards: VaultReward[]
  ): Promise<TransactionResult>
}

export interface ProtocolRegistry {
  'navi-lending': ProtocolPTB<NAVILendingVault>
  'volo-vault': ProtocolPTB<VoloVault>
}
