import { bcs } from '@mysten/sui/bcs'
import { VaultSdkError } from '../../errors'
import type { VaultSuiClient } from '../../types'
import type { VoloVault } from '../../vaults'

/**
 * The leading fields of `volo_vault::vault_receipt_info::VaultReceiptInfo`.
 *
 * BCS is positional, so `status` has to be decoded to reach `shares`; the fields after it
 * are left off, and the trailing bytes ignored. Read as a dynamic field rather than
 * through a view function: the contract's getter returns `&VaultReceiptInfo`, and a
 * reference cannot be a PTB value. The struct lives in the vault's
 * `receipts: Table<address, VaultReceiptInfo>`, and every Table entry *is* a dynamic
 * field, so it can be fetched and decoded directly.
 */
const VaultReceiptInfoStruct = bcs.struct('VaultReceiptInfo', {
  status: bcs.U8,
  shares: bcs.U256
})

/** Settled share balance of one Volo position, which is what receipt selection needs. */
export type VoloReceiptInfo = {
  receiptId: string
  shares: bigint
}

type DynamicFieldApi = {
  getDynamicField?(input: unknown): Promise<{
    dynamicField?: { value?: { bcs?: Uint8Array } }
  }>
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

  // A receipt with no Table entry is a normal state, not an error: the object can exist
  // before the vault records anything against it. The client reports the derived field id
  // as a missing object, so that one case is turned back into "no entry".
  let response
  try {
    response = await api.getDynamicField({
      parentId: receiptsTableId,
      // Must be a real Uint8Array: the client hashes the key into the field id.
      name: { type: 'address', bcs: bcs.Address.serialize(receiptId).toBytes() }
    })
  } catch (error) {
    if (/not found/i.test(error instanceof Error ? error.message : String(error))) return undefined
    throw error
  }

  const bytes = response?.dynamicField?.value?.bcs
  if (!bytes) return undefined

  return { receiptId, shares: BigInt(VaultReceiptInfoStruct.parse(bytes).shares) }
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
