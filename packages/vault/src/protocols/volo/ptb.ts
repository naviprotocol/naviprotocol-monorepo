import {
  Transaction,
  TransactionResult,
  TransactionObjectArgument,
  TransactionArgument
} from '@mysten/sui/transactions'
import { parseToUnits } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Vault } from '../../types'
import { parseTxValue } from '../../utils'
import { checkVault } from './utils'
import {
  canRequestDeposit,
  canRequestWithdraw,
  getVaultReceiptsWithView,
  planReceiptWithdraw,
  receiptType
} from './receipt'
import { vaultErrors } from '../../error'

// ------ user_entry -------
export async function depositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  amount: bigint | TransactionArgument | TransactionResult,
  options?: {
    client?: SuiGrpcClient
    coin?: TransactionObjectArgument
    useGasCoin?: boolean
    /** Minimum shares the deposit must mint (`user_entry::deposit`'s expected_shares floor). */
    expectedShares?: bigint
  }
): Promise<TransactionResult> {
  checkVault(vault)
  const { receipts } = await getVaultReceiptsWithView(vault, owner, options)

  const depositable = receipts
    // .filter(canRequestDeposit)
    .sort((a, b) => (a.shares < b.shares ? -1 : a.shares > b.shares ? 1 : 0))
  const receipt = depositable[0]

  const receiptOption = receipt
    ? tx.moveCall({
      target: '0x1::option::some',
      typeArguments: [receiptType],
      arguments: [tx.object(receipt.id)]
    })
    : tx.moveCall({ target: '0x1::option::none', typeArguments: [receiptType] })

  let coin = options?.coin
  if (!coin) {
    if (typeof amount === 'bigint') {
      coin = tx.coin({
        balance: amount,
        type: vault.assets.baseCoin.coinType,
        useGasCoin: options?.useGasCoin
      })
    } else {
      throw vaultErrors.invalidAmount('amount must be bigint when coin is not provided', {
        receivedType: typeof amount
      })
    }
  }

  const deposit = tx.moveCall({
    target: `${vault!.volo!.package}::user_entry::deposit`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(vault.id),
      tx.object(vault!.volo!.rewardManager),
      parseTxValue(coin, tx.object),
      parseTxValue(amount, tx.pure.u64),
      tx.pure.u256(options?.expectedShares ?? 0n),
      parseTxValue(receiptOption, tx.object),
      tx.object('0x6')
    ]
  })

  // user_entry::deposit returns (request_id, Receipt, change). Feeding the returned
  // request_id into the recorder keeps the off-chain record tied to the request the
  // contract actually created, instead of a pre-read counter.
  recordUserDepositPTB(tx, vault, owner, deposit[0], amount)

  return deposit;
}

/**
 * Withdraw target in the units the Volo vault contract works with:
 * `user_entry::withdraw*` burns SHARES (u256). An `amount` target is converted to
 * shares from the API's totalStaked/totalShares snapshot — the executed request
 * settles at the rate an operator executes it at, so the conversion is an estimate.
 */
export type VoloWithdrawTarget =
  | { kind: 'amount'; amount: bigint }
  | { kind: 'shares'; shares: bigint }
  | { kind: 'all' }

export async function withdrawPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  target: VoloWithdrawTarget,
  options?: {
    client?: SuiGrpcClient
  }
): Promise<TransactionResult[]> {
  checkVault(vault)
  const { view, receipts } = await getVaultReceiptsWithView(vault, owner, options)

  // The contract rejects a second withdraw request on a receipt that already has one
  // pending (ERR_WRONG_RECEIPT_STATUS) and any withdraw before the per-receipt lock
  // expires (ERR_WITHDRAW_LOCKED), so those receipts are excluded from planning and
  // surfaced in the error details when the rest cannot cover the request.
  const now = Date.now()
  const lockingTimeMs = view?.lockingTimeForWithdrawMs ?? 0
  const excludedReceipts: { id: string; reason: string }[] = []
  const withdrawable = receipts.filter((receipt) => {
    if (receipt.shares <= 0n) return false
    if (!canRequestWithdraw(receipt)) {
      excludedReceipts.push({ id: receipt.id, reason: 'a withdraw request is already pending' })
      return false
    }
    if (receipt.lastDepositTime + lockingTimeMs > now) {
      excludedReceipts.push({ id: receipt.id, reason: 'locked since the last executed deposit' })
      return false
    }
    return true
  })

  let shares: bigint
  if (target.kind === 'all') {
    shares = withdrawable.reduce((sum, receipt) => sum + receipt.shares, 0n)
    if (shares === 0n) {
      throw vaultErrors.insufficientBalance('No Volo receipt has shares available to withdraw', {
        vaultId: vault.id,
        owner,
        excludedReceipts
      })
    }
  } else if (target.kind === 'shares') {
    shares = target.shares
  } else {
    shares = sharesFromAmount(vault, target.amount)
  }
  if (shares <= 0n) {
    throw vaultErrors.invalidAmount('withdraw shares must be greater than zero', {
      target: { ...target } as Record<string, unknown>
    })
  }

  const { plans, shortfall } = planReceiptWithdraw(withdrawable, shares)
  if (plans.length === 0 || shortfall > 0n) {
    throw vaultErrors.insufficientBalance('Volo receipts cannot cover the requested withdrawal', {
      vaultId: vault.id,
      owner,
      requestedShares: shares.toString(),
      uncoveredShares: shortfall.toString(),
      excludedReceipts
    })
  }

  const requestIds: TransactionResult[] = []
  for (const plan of plans) {
    const requestId = tx.moveCall({
      target: `${vault!.volo!.package}::user_entry::withdraw_with_auto_transfer`,
      typeArguments: [vault.assets.baseCoin.coinType],
      arguments: [
        tx.object(vault.id),
        tx.pure.u256(plan.shares),
        tx.pure.u64(0),
        tx.object(plan.id),
        tx.object('0x6')
      ]
    })
    // Every withdraw call claims its own incrementing request id and returns it, so each
    // request gets its own record carrying the shares that were actually requested.
    recordUserWithdrawPTB(tx, vault, owner, requestId, plan.shares)
    requestIds.push(requestId)
  }

  return requestIds
}

/**
 * amount (raw base units) -> shares, from the API's human-unit `totalStaked` and raw
 * `totalShares`. Fixed-point all the way: totalStaked is rendered at the coin's decimals
 * and parsed exactly, so fractional values (108.13407592) convert instead of crashing.
 */
function sharesFromAmount(vault: Vault, amount: bigint): bigint {
  const decimals = vault.assets.baseCoin.decimals
  if (typeof vault.totalStaked !== 'number' || !Number.isFinite(vault.totalStaked)) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'totalStaked is missing', {
      totalStaked: String(vault.totalStaked)
    })
  }
  if (typeof vault.totalShares !== 'string') {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'totalShares is missing', {
      totalShares: String(vault.totalShares)
    })
  }
  let totalStakedRaw: bigint
  let totalShares: bigint
  try {
    totalStakedRaw = parseToUnits(vault.totalStaked.toFixed(decimals), decimals)
    totalShares = BigInt(vault.totalShares)
  } catch (error) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'totalStaked/totalShares cannot be parsed', {
      totalStaked: vault.totalStaked,
      totalShares: vault.totalShares,
      cause: error instanceof Error ? error.message : String(error)
    })
  }
  if (totalStakedRaw <= 0n || totalShares <= 0n) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'vault has no staked balance to price shares', {
      totalStaked: vault.totalStaked,
      totalShares: vault.totalShares
    })
  }
  return (amount * totalShares) / totalStakedRaw
}

// ------ vault_deposit_recorder ------
export function recordUserDepositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string | TransactionResult,
  requestId: bigint | number | string | TransactionResult | TransactionArgument,
  amount: bigint | number | TransactionResult | TransactionArgument
) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.statusRecord}::vault_deposit_recorder::record_user_deposit_v2`,
    arguments: [
      tx.pure.address(vault.id),
      parseTxValue(requestId, tx.pure.u64),
      parseTxValue(owner, tx.pure.address),
      tx.pure.string(vault.protocol),
      parseTxValue(amount, tx.pure.u64)
    ]
  })
}

export function recordUserWithdrawPTB(
  tx: Transaction,
  vault: Vault,
  owner: string | TransactionResult,
  requestId: bigint | number | string | TransactionResult | TransactionArgument,
  shares: bigint | number | TransactionResult
) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.statusRecord}::vault_deposit_recorder::record_user_withdraw_v2`,
    arguments: [
      tx.pure.address(vault.id),
      parseTxValue(requestId, tx.pure.u64),
      parseTxValue(owner, tx.pure.address),
      tx.pure.string(vault.protocol),
      parseTxValue(shares, tx.pure.u256)
    ]
  })
}
