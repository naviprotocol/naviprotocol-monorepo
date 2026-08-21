import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { operationNotSupported, VaultSdkError } from '../errors'
import type { VaultModuleContext } from '../module-context'
import { createProtocolRegistry } from '../protocols'
import type { ProtocolRegistry } from '../protocols'
import type { IntegerString } from '../types'
import type { Vault, VaultIdentifier } from '../vaults'
import type { DepositPTBOptions, WithdrawPTBOptions } from './options'
import { getPositions } from './positions'
import { getPendingRequests } from './requests'
import type {
  GetPendingRequestsOptions,
  GetPositionsOptions,
  PendingRequest,
  UserModule,
  VaultReward,
  VaultUserPosition,
  WithdrawTarget
} from './types'

/**
 * Resolves a `VaultIdentifier` to the `Vault` the PTB builders need.
 *
 * A vault id alone is not enough: the builders read `contractConfig`, so an id has to be
 * looked up through `vaults.getVault`. Until that is implemented, callers pass a resolved
 * `Vault`.
 */
async function resolveVault(context: VaultModuleContext, vault: VaultIdentifier): Promise<Vault> {
  if (typeof vault !== 'string') return vault
  void context
  throw new VaultSdkError(
    'VAULT_CONFIG_INVALID',
    `Cannot resolve vault "${vault}": vaults.getVault is not implemented yet. ` +
      `Pass a resolved Vault object instead of an id.`
  )
}

class DefaultUserModule implements UserModule {
  readonly #context: VaultModuleContext
  readonly #protocols: ProtocolRegistry

  constructor(context: VaultModuleContext) {
    this.#context = context
    this.#protocols = createProtocolRegistry(context)
  }

  async getPositions(owner: string, options?: GetPositionsOptions): Promise<VaultUserPosition[]> {
    return getPositions(this.#context, owner, options)
  }

  async getPendingRequests(
    owner: string,
    options?: GetPendingRequestsOptions
  ): Promise<PendingRequest[]> {
    return getPendingRequests(this.#context, owner, options)
  }

  async getRewards(vault: VaultIdentifier, owner: string): Promise<VaultReward[]> {
    void vault
    void owner
    return operationNotSupported('user.getRewards')
  }

  async depositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    amount: IntegerString,
    options?: DepositPTBOptions
  ): Promise<TransactionResult> {
    const resolved = await resolveVault(this.#context, vault)
    switch (resolved.protocol) {
      case 'navi-lending':
        return this.#protocols['navi-lending'].depositPTB(tx, resolved, owner, amount, options)
      case 'volo-vault':
        return this.#protocols['volo-vault'].depositPTB(tx, resolved, owner, amount, options)
    }
  }

  async withdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
  ): Promise<TransactionResult> {
    const resolved = await resolveVault(this.#context, vault)
    switch (resolved.protocol) {
      case 'navi-lending':
        return this.#protocols['navi-lending'].withdrawPTB(tx, resolved, owner, target, options)
      case 'volo-vault':
        return this.#protocols['volo-vault'].withdrawPTB(tx, resolved, owner, target, options)
    }
  }

  async cancelDepositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult> {
    const resolved = await resolveVault(this.#context, vault)
    switch (resolved.protocol) {
      case 'navi-lending':
        return this.#protocols['navi-lending'].cancelDepositPTB(
          tx,
          resolved,
          owner,
          requestId,
          receipt
        )
      case 'volo-vault':
        return this.#protocols['volo-vault'].cancelDepositPTB(
          tx,
          resolved,
          owner,
          requestId,
          receipt
        )
    }
  }

  async cancelWithdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: IntegerString,
    receipt: string | TransactionObjectArgument
  ): Promise<TransactionResult> {
    const resolved = await resolveVault(this.#context, vault)
    switch (resolved.protocol) {
      case 'navi-lending':
        return this.#protocols['navi-lending'].cancelWithdrawPTB(
          tx,
          resolved,
          owner,
          requestId,
          receipt
        )
      case 'volo-vault':
        return this.#protocols['volo-vault'].cancelWithdrawPTB(
          tx,
          resolved,
          owner,
          requestId,
          receipt
        )
    }
  }

  async claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    rewards: VaultReward[]
  ): Promise<TransactionResult> {
    const resolved = await resolveVault(this.#context, vault)
    switch (resolved.protocol) {
      case 'navi-lending':
        return this.#protocols['navi-lending'].claimRewardsPTB(tx, resolved, owner, rewards)
      case 'volo-vault':
        return this.#protocols['volo-vault'].claimRewardsPTB(tx, resolved, owner, rewards)
    }
  }
}

export function createUserModule(context: VaultModuleContext): UserModule {
  return new DefaultUserModule(context)
}

export type { DepositPTBOptions, WithdrawPTBOptions } from './options'
export type {
  GetPendingRequestsOptions,
  GetPositionsOptions,
  NAVIPositionDetail,
  PendingRequest,
  UserModule,
  VaultReward,
  VaultUserPosition,
  VoloPositionDetail,
  WithdrawTarget
} from './types'
