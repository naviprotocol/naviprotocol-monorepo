import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { operationNotSupported } from '../errors'
import type { HumanAmount, IntegerString, VaultProtocol } from '../types'
import type { Vault } from '../vaults'
import type { DepositPTBOptions, VaultReward, WithdrawPTBOptions, WithdrawTarget } from '../user'
import type { ProtocolPTB } from './types'

/**
 * A `ProtocolPTB` whose every operation throws.
 *
 * Used as the base for a protocol that is not implemented yet, and to fill in the
 * operations a protocol genuinely does not have — `cancelDeposit` on an `instant` vault,
 * for instance, where there is no pending request to cancel.
 */
export function createUnsupportedProtocolPTB<TVault extends Vault>(
  protocol: VaultProtocol
): ProtocolPTB<TVault> {
  return {
    async depositPTB(
      tx: Transaction,
      vault: TVault,
      owner: string,
      amount: HumanAmount,
      options?: DepositPTBOptions
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void amount
      void options
      return operationNotSupported(`protocols.${protocol}.depositPTB`)
    },

    async withdrawPTB(
      tx: Transaction,
      vault: TVault,
      owner: string,
      target: WithdrawTarget,
      options?: WithdrawPTBOptions
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void target
      void options
      return operationNotSupported(`protocols.${protocol}.withdrawPTB`)
    },

    async cancelDepositPTB(
      tx: Transaction,
      vault: TVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void requestId
      void receipt
      return operationNotSupported(`protocols.${protocol}.cancelDepositPTB`)
    },

    async cancelWithdrawPTB(
      tx: Transaction,
      vault: TVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void requestId
      void receipt
      return operationNotSupported(`protocols.${protocol}.cancelWithdrawPTB`)
    },

    async claimRewardsPTB(
      tx: Transaction,
      vault: TVault,
      owner: string,
      rewards: VaultReward[]
    ): Promise<TransactionResult> {
      void tx
      void vault
      void owner
      void rewards
      return operationNotSupported(`protocols.${protocol}.claimRewardsPTB`)
    }
  }
}
