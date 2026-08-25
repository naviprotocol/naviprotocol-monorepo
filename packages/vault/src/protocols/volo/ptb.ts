import {
  Transaction,
  TransactionResult,
  TransactionObjectArgument,
  TransactionArgument
} from '@mysten/sui/transactions'
import { Vault } from '../../types'
import { parseTxValue } from '../../utils'
import { checkVault } from './utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { getVaultReceipts, planReceiptWithdraw, receiptType } from './receipt'

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
    expectedShares?: number
  }
): Promise<TransactionResult> {
  checkVault(vault)
  const receipts = await getVaultReceipts(vault, owner, options)
  receipts.sort((a, b) => {
    return Number(a.shares - b.shares)
  })
  const receipt = receipts[0]

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
    }
    throw new Error('amount should be bigint')
  }

  const requestId = newDepositRequestPTB(tx, vault)

  recordUserDepositPTB(tx, vault, owner, requestId, amount)

  return tx.moveCall({
    target: `${vault!.volo!.package}::user_entry::deposit`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(vault.id),
      tx.object(vault!.volo!.rewardManager),
      parseTxValue(coin, tx.object),
      parseTxValue(amount, tx.pure.u64),
      parseTxValue(options?.expectedShares || 0, tx.pure.u256),
      parseTxValue(receiptOption, tx.object),
      tx.object('0x6')
    ]
  })
}

export async function withdrawPTB(
  tx: Transaction,
  vault: Vault,
  owner: string,
  shares: bigint,
  options?: {
    client?: SuiGrpcClient
  }
) {
  checkVault(vault)

  const requestId = newWithRequestPTB(tx, vault)
  recordUserWithdrawPTB(tx, vault, owner, requestId, shares)
  const receipts = await getVaultReceipts(vault, owner, options)
  const withdrawReceipts = planReceiptWithdraw(receipts, shares)
  for (let i = 0; i < withdrawReceipts.length; i++) {
    const receipt = withdrawReceipts[i]
    tx.moveCall({
      target: `${vault!.volo!.package}::user_entry::withdraw_with_auto_transfer`,
      typeArguments: [vault.assets.baseCoin.coinType],
      arguments: [
        tx.object(vault.id),
        tx.pure.u256(receipt.shares),
        tx.pure.u64(0),
        tx.object(receipt.id),
        tx.object('0x6')
      ]
    })
  }
}

// ------ vault -------
export function newDepositRequestPTB(tx: Transaction, vault: Vault) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.package}::vault::deposit_id_count`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [tx.object(vault.id)]
  })
}
export function newWithRequestPTB(tx: Transaction, vault: Vault) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.package}::vault::withdraw_id_count`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [tx.object(vault.id)]
  })
}

// ------ vault_deposit_recorder ------
export function recordUserDepositPTB(
  tx: Transaction,
  vault: Vault,
  owner: string | TransactionResult,
  requestId: string | TransactionResult,
  amount: bigint | number | TransactionResult | TransactionArgument
) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.statusRecord}::vault_deposit_recorder::record_user_deposit_v2`,
    arguments: [
      tx.pure.address(vault.id),
      parseTxValue(requestId, tx.object),
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
  requestId: string | TransactionResult,
  shares: bigint | number | TransactionResult
) {
  checkVault(vault)
  return tx.moveCall({
    target: `${vault!.volo!.statusRecord}::vault_deposit_recorder::record_user_withdraw_v2`,
    arguments: [
      tx.pure.address(vault.id),
      parseTxValue(requestId, tx.object),
      parseTxValue(owner, tx.pure.address),
      tx.pure.string(vault.protocol),
      parseTxValue(shares, tx.pure.u256)
    ]
  })
}
