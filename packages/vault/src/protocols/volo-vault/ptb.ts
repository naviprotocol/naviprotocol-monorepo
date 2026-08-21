import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { parseBaseUnits } from '../../amount'
import { VaultSdkError } from '../../errors'
import type { VaultModuleContext } from '../../module-context'
import type { IntegerString } from '../../types'
import type { DepositPTBOptions, VaultReward, WithdrawPTBOptions, WithdrawTarget } from '../../user'
import type { VoloVaultContractConfig, VoloVault } from '../../vaults'
import type { ProtocolPTB } from '../types'
import { listReceipts, prepareExactCoin } from '../shared/chain'
import { CLOCK_OBJECT_ID, ORIGINAL_PACKAGE_ID } from '../shared/constants'
import { pickReceiptWithMostShares } from './receipt-info'

const USER_ENTRY = 'user_entry'
const REWARD_MANAGER = 'reward_manager'

/**
 * Volo takes slippage as a floor, not a ceiling: `expected_shares` on deposit and
 * `expected_amount` on withdraw. Zero means "no bound" on both, matching how the Volo
 * backend calls the contract. Callers wanting a bound compose the entrypoints directly.
 */
const NO_BOUND = 0n

function target(
  config: VoloVaultContractConfig,
  module: string,
  fn: string
): `${string}::${string}::${string}` {
  return `${config.package}::${module}::${fn}`
}

function normalizeCoinType(coinType: string): string {
  const [address, ...rest] = coinType.split('::')
  const hex = (address ?? '').startsWith('0x') ? (address ?? '').slice(2) : (address ?? '')
  return [`0x${hex.toLowerCase().padStart(64, '0')}`, ...rest].join('::')
}

/**
 * Resolves a withdrawal target to the share count the contract takes.
 *
 * `user_entry::withdraw` is denominated in shares, so an asset-denominated target cannot
 * be honoured exactly — converting would need a share price the caller has no way to pin
 * to execution time. `all` needs the holder's balance, which is a backend query.
 */
function resolveWithdrawShares(target_: WithdrawTarget): bigint {
  switch (target_.kind) {
    case 'shares':
      if (typeof target_.shares !== 'string') {
        throw new VaultSdkError(
          'OPERATION_NOT_SUPPORTED',
          `Volo's withdraw takes a plain share count; a TransactionResult cannot be used ` +
            `because the request is recorded now and settled by an operator later.`
        )
      }
      return BigInt(target_.shares)
    case 'amount':
      throw new VaultSdkError(
        'OPERATION_NOT_SUPPORTED',
        `user_entry::withdraw takes shares, not an asset amount. Convert with the holder's ` +
          `current share price and pass { kind: 'shares' }.`
      )
    case 'all':
      throw new VaultSdkError(
        'OPERATION_NOT_SUPPORTED',
        `A full exit needs the holder's settled share balance, which comes from ` +
          `user.getPositions. Pass { kind: 'shares' } with that value.`
      )
  }
}

async function resolveReceipt(
  context: VaultModuleContext,
  tx: Transaction,
  vault: VoloVault,
  owner: string,
  operation: string,
  provided?: string | TransactionObjectArgument
): Promise<TransactionObjectArgument | undefined> {
  if (provided !== undefined) {
    return typeof provided === 'string' ? tx.object(provided) : provided
  }

  // Top up the owner's position when they hold one, mint a new one when they hold none.
  // Without this every deposit opens a fresh position and abandons the previous one.
  const receipts = await listReceipts(
    context.client,
    {
      originalPackageId: ORIGINAL_PACKAGE_ID[vault.protocol],
      module: 'receipt',
      vaultId: vault.id
    },
    owner
  )
  // Mirrors the Volo backend: among several receipts it acts on the one with the most
  // settled shares. Reading them is a dynamic-field lookup per receipt, skipped entirely
  // in the common single-receipt case.
  void operation
  const chosen = await pickReceiptWithMostShares(context.client, vault, receipts)
  return chosen ? tx.object(chosen) : undefined
}

export function createVoloVaultPTB(context: VaultModuleContext): ProtocolPTB<VoloVault> {
  return {
    /**
     * Records a deposit request and returns `(request_id, Receipt, change)`.
     *
     * Volo is `eventual`: shares are not minted here. An operator executes the queued
     * request later, and only then does the position change. All three returned values
     * must be consumed by the transaction — the caller transfers the receipt and the
     * change coin.
     */
    async depositPTB(
      tx: Transaction,
      vault: VoloVault,
      owner: string,
      amount: IntegerString,
      options?: DepositPTBOptions
    ): Promise<TransactionResult> {
      // Validate configuration and arguments before any I/O: a missing RewardManager or a
      // malformed amount should not cost a round trip to discover.
      const config = vault.contractConfig
      const manager = config.volo.rewardManagerObjectId
      const baseUnits = parseBaseUnits(amount)
      if (baseUnits <= 0n) {
        throw new VaultSdkError('INVALID_AMOUNT', 'Deposit amount must be greater than zero.')
      }

      const receipt = await resolveReceipt(context, tx, vault, owner, 'deposit', options?.receipt)
      const receiptType = `${ORIGINAL_PACKAGE_ID[vault.protocol]}::receipt::Receipt`
      const receiptOption = receipt
        ? tx.moveCall({
            target: '0x1::option::some',
            typeArguments: [receiptType],
            arguments: [receipt]
          })
        : tx.moveCall({ target: '0x1::option::none', typeArguments: [receiptType] })

      const coin =
        options?.coin ??
        (await prepareExactCoin(tx, context.client, {
          owner,
          coinType: vault.assets.base.coinType,
          amount: baseUnits,
          useGasCoin: options?.useGasCoin
        }))

      return tx.moveCall({
        target: target(config, USER_ENTRY, 'deposit'),
        typeArguments: [vault.assets.base.coinType],
        arguments: [
          tx.object(vault.id),
          tx.object(manager),
          coin,
          tx.pure.u64(baseUnits),
          tx.pure.u256(NO_BOUND),
          receiptOption,
          tx.object(CLOCK_OBJECT_ID)
        ]
      })
    },

    /**
     * Records a withdrawal request and returns its `request_id`.
     *
     * Nothing is paid out here. An operator settles the request and transfers the
     * proceeds, which is why there is no user-side claim step.
     */
    async withdrawPTB(
      tx: Transaction,
      vault: VoloVault,
      owner: string,
      target_: WithdrawTarget,
      options?: WithdrawPTBOptions
    ): Promise<TransactionResult> {
      const config = vault.contractConfig
      const shares = resolveWithdrawShares(target_)
      if (shares <= 0n) {
        throw new VaultSdkError('INVALID_AMOUNT', 'Withdrawal share count must be positive.')
      }

      const receipt = await resolveReceipt(context, tx, vault, owner, 'withdraw', options?.receipt)
      if (!receipt) {
        throw new VaultSdkError(
          'REQUEST_NOT_FOUND',
          `${owner} holds no receipt on vault ${vault.id}.`
        )
      }

      return tx.moveCall({
        target: target(config, USER_ENTRY, 'withdraw'),
        typeArguments: [vault.assets.base.coinType],
        arguments: [
          tx.object(vault.id),
          tx.pure.u256(shares),
          tx.pure.u64(NO_BOUND),
          receipt,
          tx.object(CLOCK_OBJECT_ID)
        ]
      })
    },

    /** Cancels a queued deposit and returns the refunded coin, which the caller consumes. */
    async cancelDepositPTB(
      tx: Transaction,
      vault: VoloVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void owner
      const config = vault.contractConfig
      return tx.moveCall({
        target: target(config, USER_ENTRY, 'cancel_deposit'),
        typeArguments: [vault.assets.base.coinType],
        arguments: [
          tx.object(vault.id),
          typeof receipt === 'string' ? tx.object(receipt) : receipt,
          tx.pure.u64(BigInt(requestId)),
          tx.object(CLOCK_OBJECT_ID)
        ]
      })
    },

    /** Cancels a queued withdrawal and returns the shares put back, as a `u256`. */
    async cancelWithdrawPTB(
      tx: Transaction,
      vault: VoloVault,
      owner: string,
      requestId: IntegerString,
      receipt: string | TransactionObjectArgument
    ): Promise<TransactionResult> {
      void owner
      const config = vault.contractConfig
      return tx.moveCall({
        target: target(config, USER_ENTRY, 'cancel_withdraw'),
        typeArguments: [vault.assets.base.coinType],
        arguments: [
          tx.object(vault.id),
          typeof receipt === 'string' ? tx.object(receipt) : receipt,
          tx.pure.u64(BigInt(requestId)),
          tx.object(CLOCK_OBJECT_ID)
        ]
      })
    },

    /**
     * Claims rewards through the vault's `RewardManager`, one call per receipt and reward
     * coin. There is no harvest step: `claim_reward` refreshes the reward buffers itself.
     */
    async claimRewardsPTB(
      tx: Transaction,
      vault: VoloVault,
      owner: string,
      rewards: VaultReward[]
    ): Promise<TransactionResult> {
      void owner
      if (rewards.length === 0) {
        throw new VaultSdkError('INVALID_AMOUNT', 'No rewards selected to claim.')
      }

      const config = vault.contractConfig
      const manager = config.volo.rewardManagerObjectId

      // Same as NAVI: one Coin per claim, so each coin type's outputs are merged into one.
      // Returning just the last would leave the rest unconsumed and the block invalid.
      const byCoinType = new Map<string, TransactionObjectArgument[]>()
      for (const reward of rewards) {
        const coin = tx.moveCall({
          target: target(config, REWARD_MANAGER, 'claim_reward'),
          typeArguments: [vault.assets.base.coinType, reward.rewardCoinType],
          arguments: [
            tx.object(manager),
            tx.object(vault.id),
            tx.object(CLOCK_OBJECT_ID),
            tx.object(reward.receiptId)
          ]
        })
        const key = normalizeCoinType(reward.rewardCoinType)
        const group = byCoinType.get(key)
        if (group) group.push(coin as TransactionObjectArgument)
        else byCoinType.set(key, [coin as TransactionObjectArgument])
      }

      let survivor: TransactionObjectArgument | undefined
      for (const coins of byCoinType.values()) {
        const [first, ...rest] = coins
        if (rest.length > 0) tx.mergeCoins(first!, rest)
        survivor = first
      }

      // One coin type survives as the return value; the others are merged and still live
      // for the caller to consume. Claiming several reward types therefore means reading
      // the block's results rather than relying on this single handle.
      return survivor as unknown as TransactionResult
    }
  }
}
