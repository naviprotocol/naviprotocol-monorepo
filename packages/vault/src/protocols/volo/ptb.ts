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
/**
 * Builds a deposit request into a Volo vault, in raw base units.
 *
 * Volo deposits are asynchronous: this creates a `DepositRequest` that an operator later
 * executes, minting shares at that point's exchange rate (subject to `expectedShares`).
 * Reuses the owner's lowest-share existing receipt if one exists; otherwise the contract
 * mints a new one. Also records the request off-chain via {@link recordUserDepositPTB} so
 * it surfaces through the NAVI open API's pending-requests endpoint.
 *
 * The top-level `depositPTB` wraps this with human-unit amount parsing and source dispatch.
 *
 * @param tx - Transaction to append the deposit calls to
 * @param vault - The Volo vault to deposit into. Must carry `vault.volo` config
 * @param owner - Sui address the request pays out to, and whose receipts are searched for one to reuse
 * @param amount - Deposit amount in RAW base units. Must be a `bigint` unless `options.coin`
 *                 is given, in which case a transaction argument is also accepted
 * @param options - Optional coin source, client override, and slippage floor
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @param options.coin - Coin object to deposit from. When omitted, one is split from the owner's
 *                       balance (or gas coin, with `useGasCoin`) for `amount`
 * @param options.useGasCoin - Split the deposit coin from the transaction's gas coin instead of
 *                             a coin object lookup. Ignored when `coin` is given
 * @param options.expectedShares - Minimum shares the request must mint when executed, enforced
 *                                 on-chain. Defaults to `0n`, i.e. no floor
 * @returns Promise<TransactionResult> - The `user_entry::deposit` result:
 *          `[request_id, Receipt, change]`. The receipt and change are unconsumed
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault, or
 *         `INVALID_AMOUNT` when `amount` is not a `bigint` and no `coin` was supplied
 */
export async function depositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  amount: bigint | TransactionArgument | TransactionResult,
  options?: {
    client?: SuiGrpcClient
    coin?: TransactionObjectArgument
    useGasCoin?: boolean
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

  return deposit
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

/**
 * Builds one or more withdraw requests from a Volo vault, in raw base units / shares.
 *
 * Excludes receipts with an already-pending withdraw or still inside the vault's
 * withdraw lock (see {@link canRequestWithdraw}), plans which of the remaining receipts to
 * draw from (via {@link planReceiptWithdraw}), and issues one
 * `user_entry::withdraw_with_auto_transfer` call per receipt in the plan — each creating
 * its own `WithdrawRequest` that an operator later executes and pays out to `owner`.
 * Also records each request off-chain via {@link recordUserWithdrawPTB}.
 *
 * The top-level `withdrawPTB` wraps this with human-unit amount parsing and source dispatch.
 *
 * @param tx - Transaction to append the withdrawal calls to
 * @param vault - The Volo vault to withdraw from. Must carry `vault.volo` config
 * @param owner - Sui address whose receipts are drawn from, and which the requests pay out to
 * @param target - What to withdraw, in raw base units or raw shares; see {@link VoloWithdrawTarget}.
 *        `'all'` covers only the receipts eligible right now, not those still locked or already
 *        carrying a pending withdraw
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<TransactionResult[]> - The created request ids, one per receipt drawn from
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault,
 *         `INSUFFICIENT_BALANCE` when the eligible receipts cannot cover the request (the
 *         error's `details.excludedReceipts` says which were skipped and why), `INVALID_AMOUNT`
 *         when the resolved share count is not positive, or `VAULT_CONFIG_INVALID` when an
 *         `amount` target cannot be priced from the vault's `totalStaked`/`totalShares`
 */
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
 *
 * The rate comes from the API snapshot, not the chain, and the request settles at whatever
 * rate the operator executes it at — so this is an estimate, not a guarantee.
 *
 * @param vault - Vault supplying the decimals and the `totalStaked`/`totalShares` rate
 * @param amount - Amount in raw base units to convert
 * @returns The equivalent share count, floored
 * @throws VaultSdkError with code `VAULT_CONFIG_INVALID` when `totalStaked`/`totalShares` are
 *         missing, unparsable, or non-positive
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
/**
 * Records a Volo deposit request off-chain so it surfaces through the NAVI open API's
 * pending-requests endpoint.
 *
 * {@link depositPTB} already calls this, so most callers never need it directly. Call it once
 * per created `DepositRequest`, passing the request id the contract call returned rather than
 * a pre-read counter, so the record matches the request actually created.
 *
 * @param tx - Transaction to append the record call to
 * @param vault - The Volo vault the deposit targets. Must carry `vault.volo` config
 * @param owner - Sui address credited with the deposit, as an address or a transaction argument
 * @param requestId - The `request_id` returned by `user_entry::deposit`, as a literal or argument
 * @param amount - Deposited amount in raw base units, as a literal or argument
 * @returns TransactionResult - The recorder call's result. Carries no value to consume
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault
 */
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

/**
 * Records a Volo withdraw request off-chain so it surfaces through the NAVI open API's
 * pending-requests endpoint.
 *
 * {@link withdrawPTB} already calls this, so most callers never need it directly. Call it once
 * per created `WithdrawRequest` — a withdrawal split across several receipts creates several
 * requests, each needing its own record with the shares that request actually asked for.
 *
 * @param tx - Transaction to append the record call to
 * @param vault - The Volo vault the withdrawal targets. Must carry `vault.volo` config
 * @param owner - Sui address the withdrawal is debited from, as an address or a transaction argument
 * @param requestId - The `request_id` returned by the withdraw call, as a literal or argument
 * @param shares - Shares this request burns (u256), as a literal or argument
 * @returns TransactionResult - The recorder call's result. Carries no value to consume
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault
 */
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
