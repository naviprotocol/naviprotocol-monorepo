import { bcs, type BcsType } from '@mysten/sui/bcs'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Vault } from '../../types'
import { getSuiClient } from '../../utils'
import { checkVault } from './utils'
import { vaultErrors } from '../../error'

export const receiptType = `0xcd86f77503a755c48fe6c87e1b8e9a137ec0c1bf37aac8878b6083262b27fefa::receipt::Receipt`

export const ReceiptStruct: BcsType<
  {
    id: string
    vaultId: string
  },
  { id: string | Uint8Array; vaultId: string | Uint8Array }
> = bcs.struct('Receipt', {
  id: bcs.Address,
  vaultId: bcs.Address
})

/** A receipt held by an owner, together with the shares the vault credits to it. */
export type VaultReceipt = {
  /** Receipt object id. */
  id: string
  /**
   * Shares held under this receipt. `0n` when the vault has no `receipts` entry for it,
   * which is the case for a freshly created receipt and for one that was fully withdrawn
   * (the contract never deletes receipts or their info).
   *
   * This is the settled balance: a pending `request_withdraw` does not reduce it until an
   * operator executes the request, and a pending deposit is not part of it yet.
   */
  shares: bigint
}

/**
 * The leading fields of `vault_receipt_info::VaultReceiptInfo`.
 *
 * The remaining fields are irrelevant for receipt selection. BCS parsing is positional,
 * so decoding this prefix is enough to reach the settled share balance.
 */
const VaultReceiptInfoStruct = bcs.struct('VaultReceiptInfo', {
  status: bcs.u8(),
  shares: bcs.u256()
})

/**
 * Reads the id of the vault's `receipts: Table<address, VaultReceiptInfo>`.
 *
 * The public package has no by-value getter for receipt shares. The Vault JSON view exposes
 * the Table handle, and each receipt state can then be fetched as a normal dynamic field.
 */
async function readReceiptsTableId(client: SuiGrpcClient, vault: Vault): Promise<string> {
  const { object } = await client.getObject({
    objectId: vault.id,
    include: { json: true }
  })
  const id = (object.json as { receipts?: { id?: unknown } } | null)?.receipts?.id
  if (typeof id !== 'string') {
    throw vaultErrors.chainDataInvalid(`Volo vault ${vault.id} has no receipts table id`, {
      vaultId: vault.id
    })
  }
  return normalizeSuiAddress(id)
}

/** Settled shares for one receipt; a receipt without a table entry has zero shares. */
async function readReceiptShares(
  client: SuiGrpcClient,
  receiptsTableId: string,
  receiptId: string
): Promise<bigint> {
  try {
    const { dynamicField } = await client.getDynamicField({
      parentId: receiptsTableId,
      name: {
        type: 'address',
        bcs: bcs.Address.serialize(receiptId).toBytes()
      }
    })
    const bytes = dynamicField.value?.bcs
    if (!bytes) return 0n
    return BigInt(VaultReceiptInfoStruct.parse(Uint8Array.from(bytes)).shares)
  } catch (error) {
    if (/not found/i.test(error instanceof Error ? error.message : String(error))) {
      return 0n
    }
    throw error
  }
}

/**
 * The receipt object ids `owner` holds for `vault`.
 *
 * Object ownership is the only link from a wallet to its receipts — the vault itself keys
 * everything by receipt address and never records who holds one. A receipt deposited into
 * another vault as a defi asset (`receipt_adaptor`) therefore drops out of this list while
 * its share balance keeps living in the vault.
 */
export async function listOwnedReceiptIds(
  client: SuiGrpcClient,
  vault: Vault,
  owner: string
): Promise<string[]> {
  const vaultAddress = normalizeSuiAddress(vault.id)
  const found: string[] = []
  let cursor: string | null | undefined

  do {
    const page = await client.listOwnedObjects({
      owner,
      type: receiptType,
      cursor,
      include: { content: true }
    })

    for (const object of page.objects) {
      if (!object.content) continue
      const parsed = ReceiptStruct.parse(Uint8Array.from(object.content))
      if (normalizeSuiAddress(parsed.vaultId) !== vaultAddress) continue
      found.push(normalizeSuiAddress(object.objectId))
    }

    cursor = page.hasNextPage ? (page.cursor === cursor ? null : page.cursor) : null
  } while (cursor)

  return found
}

/**
 * Lists an owner's receipts for a vault, each with its share balance.
 *
 * Shares are read from the vault's on-chain `receipts` Table. Receipt objects only contain
 * their vault id; the settled balance lives in this dynamic field.
 */
export async function getVaultReceipts(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
  }
): Promise<VaultReceipt[]> {
  checkVault(vault)
  const client = getSuiClient(options?.client)

  const found = await listOwnedReceiptIds(client, vault, owner)

  if (found.length === 0) {
    return []
  }

  const receiptsTableId = await readReceiptsTableId(client, vault)
  const shares = await Promise.all(
    found.map((receiptId) => readReceiptShares(client, receiptsTableId, receiptId))
  )

  return found.map((id, index) => ({
    id,
    shares: shares[index]
  }))
}

export function planReceiptWithdraw(receipts: VaultReceipt[], shares: bigint) {
  const filterReceipts = receipts
    .sort((a, b) => {
      return Number(a.shares - b.shares)
    })
    .filter((a) => {
      return a.shares > 0
    })
  const plans: VaultReceipt[] = []
  let remaining = shares

  for (const receipt of filterReceipts) {
    if (remaining >= receipt.shares) {
      plans.push(receipt)
      remaining -= receipt.shares
    } else {
      plans.push({
        ...receipt,
        shares: remaining
      })
      remaining = 0n
      break
    }
  }
  return plans
}
