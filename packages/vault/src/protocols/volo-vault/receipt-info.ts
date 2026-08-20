import { bcs } from '@mysten/sui/bcs'
import { VaultSdkError } from '../../errors'
import type { VaultSuiClient } from '../../types'
import type { VoloVault } from '../../vaults'

/** `sui::table::Table`, which is `{ id: UID, size: u64 }`. */
const TableStruct = bcs.struct('Table', { id: bcs.Address, size: bcs.U64 })

/**
 * `volo_vault::vault_receipt_info::VaultReceiptInfo`, in declaration order.
 *
 * Read as a dynamic field rather than through a view function: the contract's
 * `vault_receipt_info` getter returns `&VaultReceiptInfo`, and a reference cannot be a
 * PTB value, so it is unreachable from a simulated block. The struct lives in the vault's
 * `receipts: Table<address, VaultReceiptInfo>`, and every Table entry *is* a dynamic
 * field, so it can be fetched and decoded directly.
 */
const VaultReceiptInfoStruct = bcs.struct('VaultReceiptInfo', {
  /** 0 normal, 1 pending_deposit, 2 pending_withdraw, 3 pending_withdraw_with_auto_transfer. */
  status: bcs.U8,
  shares: bcs.U256,
  pending_deposit_balance: bcs.U64,
  pending_withdraw_shares: bcs.U256,
  last_deposit_time: bcs.U64,
  claimable_principal: bcs.U64,
  reward_indices: TableStruct,
  unclaimed_rewards: TableStruct
})

/** Settled state of one Volo position. */
export type VoloReceiptInfo = {
  receiptId: string
  status: number
  shares: bigint
  pendingDepositBalance: bigint
  pendingWithdrawShares: bigint
  claimablePrincipal: bigint
}

type DynamicFieldApi = {
  getDynamicField?(input: unknown): Promise<{
    dynamicField?: { value?: { bcs?: Uint8Array | Record<string, number> } }
  }>
}

function toBytes(value: Uint8Array | Record<string, number> | undefined): Uint8Array | undefined {
  if (!value) return undefined
  return value instanceof Uint8Array ? value : Uint8Array.from(Object.values(value) as number[])
}

function addressBytes(address: string): number[] {
  const hex = (address.startsWith('0x') ? address.slice(2) : address).padStart(64, '0')
  return Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/**
 * Reads the settled state of one receipt.
 *
 * Returns `undefined` when the vault has no entry for it — a receipt object can exist
 * before the vault records anything against it.
 */
export async function readReceiptInfo(
  client: VaultSuiClient,
  receiptsTableId: string,
  receiptId: string
): Promise<VoloReceiptInfo | undefined> {
  const api = client.core as DynamicFieldApi | undefined
  if (typeof api?.getDynamicField !== 'function') {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      'Reading Volo receipt shares requires core.getDynamicField.'
    )
  }

  const response = await api.getDynamicField({
    parentId: receiptsTableId,
    name: { type: 'address', bcs: addressBytes(receiptId) }
  })

  const bytes = toBytes(response?.dynamicField?.value?.bcs)
  if (!bytes || bytes.length === 0) return undefined

  const info = VaultReceiptInfoStruct.parse(bytes)
  return {
    receiptId,
    status: info.status,
    shares: BigInt(info.shares),
    pendingDepositBalance: BigInt(info.pending_deposit_balance),
    pendingWithdrawShares: BigInt(info.pending_withdraw_shares),
    claimablePrincipal: BigInt(info.claimable_principal)
  }
}

/**
 * Picks the receipt with the most settled shares, mirroring how the Volo backend selects
 * one (`ORDER BY shares DESC LIMIT 1`).
 *
 * Falls back to the first receipt when none can be read, which is the same degraded path
 * the backend takes when its index has no row yet.
 */
export async function pickReceiptWithMostShares(
  client: VaultSuiClient,
  vault: VoloVault,
  receipts: string[]
): Promise<string | undefined> {
  if (receipts.length <= 1) return receipts[0]

  const receiptsTableId = vault.contractConfig.volo.receiptParentObjectId
  if (!receiptsTableId) {
    throw new VaultSdkError(
      'VAULT_CONFIG_INVALID',
      `${vault.id} holds ${receipts.length} receipts, and picking one needs their share ` +
        `balances — which live in the vault's receipts Table. Configure ` +
        `volo.receiptParentObjectId, or pass options.receipt.`
    )
  }

  const infos = await Promise.all(
    receipts.map((receiptId) => readReceiptInfo(client, receiptsTableId, receiptId))
  )

  let best: VoloReceiptInfo | undefined
  for (const info of infos) {
    if (!info) continue
    if (!best || info.shares > best.shares) best = info
  }
  return best?.receiptId ?? receipts[0]
}
