import { bcs, type BcsType } from '@mysten/sui/bcs'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Vault } from '../../types'
import { getSuiClient } from '../../utils'
import { checkVault } from './utils'

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

/** `vector<u256>`, the return shape of `vault::receipts_shares`. */
const SharesVector = bcs.vector(bcs.u256())

/**
 * Receipt ids per `receipts_shares` command. Every chunk rides in the same simulated
 * transaction, so a batch of any size still costs one round trip — the split only keeps a
 * single command's vector clear of the Move execution limits.
 */
const SHARES_CHUNK_SIZE = 100

/**
 * Reads the shares of many receipts in one devInspect.
 *
 * Shares are not stored in the Receipt object: the vault keeps them in
 * `Vault.receipts: Table<address, VaultReceiptInfo>`, keyed by the receipt's object address.
 * `vault::vault_receipt_info` hands back a reference, which a PTB cannot carry across
 * commands, so the batched read goes through `vault::receipts_shares` — a by-value getter
 * mapping `vector<address>` to `vector<u256>`, which reports a receipt the vault has no entry
 * for as 0 instead of aborting the whole batch.
 */
async function readReceiptsShares(
  client: SuiGrpcClient,
  vault: Vault,
  owner: string,
  receiptIds: string[]
): Promise<bigint[]> {
  const chunks: string[][] = []
  for (let index = 0; index < receiptIds.length; index += SHARES_CHUNK_SIZE) {
    chunks.push(receiptIds.slice(index, index + SHARES_CHUNK_SIZE))
  }

  const tx = new Transaction()
  tx.setSenderIfNotSet(owner)
  for (const chunk of chunks) {
    tx.moveCall({
      target: `${vault!.volo!.package}::vault::receipts_shares`,
      typeArguments: [vault.assets.baseCoin.coinType],
      arguments: [tx.object(vault.id), tx.pure.vector('address', chunk)]
    })
  }

  const result = await client.simulateTransaction({
    transaction: tx,
    // A read-only getter carries no gas coin, which the regular checks would reject.
    checksEnabled: false,
    include: { commandResults: true }
  })

  if (result.$kind === 'FailedTransaction') {
    throw new Error(
      `volo vault::receipts_shares failed: ${JSON.stringify(result.FailedTransaction.status.error)}`
    )
  }

  return chunks.flatMap((chunk, index) => {
    const bytes = result.commandResults?.[index]?.returnValues?.[0]?.bcs
    if (!bytes) {
      throw new Error('volo vault::receipts_shares returned no value')
    }

    const shares = SharesVector.parse(Uint8Array.from(bytes)).map((value) => BigInt(value))
    if (shares.length !== chunk.length) {
      throw new Error(
        `volo vault::receipts_shares returned ${shares.length} values for ${chunk.length} receipts`
      )
    }

    return shares
  })
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
 * The shares of every receipt come from a single `vault::receipts_shares` devInspect instead
 * of one read per receipt, so the cost stays flat as an owner accumulates receipts.
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

  const shares = await readReceiptsShares(client, vault, owner, found)

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
