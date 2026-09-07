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

/**
 * `vault_receipt_info::VaultReceiptInfo.status` values.
 *
 * The contract allows at most one outstanding request per direction and encodes
 * that in the receipt status: `request_withdraw` aborts unless the status is
 * NORMAL or PENDING_DEPOSIT, and `request_deposit` aborts unless it is NORMAL,
 * PENDING_WITHDRAW, or PENDING_WITHDRAW_WITH_AUTO_TRANSFER.
 */
export const RECEIPT_STATUS = {
  NORMAL: 0,
  PENDING_DEPOSIT: 1,
  PENDING_WITHDRAW: 2,
  PENDING_WITHDRAW_WITH_AUTO_TRANSFER: 3,
  PARALLEL_PENDING_DEPOSIT_WITHDRAW: 4,
  PARALLEL_PENDING_DEPOSIT_WITHDRAW_WITH_AUTO_TRANSFER: 5
} as const

/**
 * Whether `user_entry::withdraw*` would pass the receipt-status assert for this receipt.
 *
 * Only covers the status check (ERR_WRONG_RECEIPT_STATUS). The withdraw lock is a separate
 * gate — check `lastDepositTime + lockingTimeForWithdrawMs` too, as {@link withdrawPTB} does.
 *
 * @param receipt - Receipt to test; only its `status` is read
 * @returns True when a withdraw request would be accepted on status grounds
 */
export function canRequestWithdraw(receipt: Pick<VaultReceipt, 'status'>): boolean {
  return (
    receipt.status === RECEIPT_STATUS.NORMAL || receipt.status === RECEIPT_STATUS.PENDING_DEPOSIT
  )
}

/**
 * Whether `user_entry::deposit` would pass the receipt-status assert for this receipt.
 *
 * @param receipt - Receipt to test; only its `status` is read
 * @returns True when a deposit request would be accepted on status grounds
 */
export function canRequestDeposit(receipt: Pick<VaultReceipt, 'status'>): boolean {
  return (
    receipt.status === RECEIPT_STATUS.NORMAL ||
    receipt.status === RECEIPT_STATUS.PENDING_WITHDRAW ||
    receipt.status === RECEIPT_STATUS.PENDING_WITHDRAW_WITH_AUTO_TRANSFER
  )
}

/** A receipt held by an owner, together with the state the vault credits to it. */
export type VaultReceipt = {
  /** Receipt object id. */
  id: string
  /**
   * Shares held under this receipt. `0n` when the vault has no `receipts` entry for it,
   * which is the case for a freshly created receipt and for one that was fully withdrawn
   * (the contract never deletes receipts or their info).
   *
   * This is the settled balance: a pending `request_withdraw` does not reduce it until an
   * operator executes the request (only `pendingWithdrawShares` grows), and a pending
   * deposit is not part of it yet.
   */
  shares: bigint
  /** `VaultReceiptInfo.status` — see {@link RECEIPT_STATUS} for what each value allows. */
  status: number
  /** Shares earmarked by a pending `request_withdraw`, still included in `shares`. */
  pendingWithdrawShares: bigint
  /**
   * Epoch milliseconds of the last EXECUTED deposit. `user_entry::withdraw*` aborts with
   * ERR_WITHDRAW_LOCKED until `lastDepositTime + Vault.locking_time_for_withdraw`.
   */
  lastDepositTime: number
}

/**
 * The leading fields of `vault_receipt_info::VaultReceiptInfo`, in declaration order.
 *
 * The remaining fields (claimable_principal and the reward tables) are irrelevant for
 * receipt selection. BCS parsing is positional, so decoding this fixed-size prefix is
 * enough to reach the balance, status, and withdraw-lock inputs.
 */
const VaultReceiptInfoStruct = bcs.struct('VaultReceiptInfo', {
  status: bcs.u8(),
  shares: bcs.u256(),
  pending_deposit_balance: bcs.u64(),
  pending_withdraw_shares: bcs.u256(),
  last_deposit_time: bcs.u64()
})

const EMPTY_RECEIPT_STATE = {
  status: RECEIPT_STATUS.NORMAL as number,
  shares: 0n,
  pendingWithdrawShares: 0n,
  lastDepositTime: 0
}

/** Fields of the Volo vault object the PTB builders need, read once from its JSON view. */
export type VoloVaultView = {
  /** Id of `Vault.receipts: Table<address, VaultReceiptInfo>`. */
  receiptsTableId: string
  /** `Vault.locking_time_for_withdraw` in milliseconds. */
  lockingTimeForWithdrawMs: number
}

/**
 * Reads the receipts table id and the withdraw lock off the Vault object.
 *
 * The public package has no by-value getter for receipt shares. The Vault JSON view exposes
 * the Table handle, and each receipt state can then be fetched as a normal dynamic field.
 *
 * @param client - gRPC client used to fetch the vault object
 * @param vault - The Volo vault to read
 * @returns Promise<VoloVaultView> - The receipts table id and the withdraw lock in milliseconds
 * @throws VaultSdkError with code `CHAIN_DATA_INVALID` when the object exposes no receipts
 *         table id
 */
export async function readVoloVaultView(
  client: SuiGrpcClient,
  vault: Vault
): Promise<VoloVaultView> {
  const { object } = await client.getObject({
    objectId: vault.id,
    include: { json: true }
  })
  const json = object.json as {
    receipts?: { id?: unknown }
    locking_time_for_withdraw?: unknown
  } | null
  const rawId = json?.receipts?.id
  const id = typeof rawId === 'string' ? rawId : (rawId as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string') {
    throw vaultErrors.chainDataInvalid(`Volo vault ${vault.id} has no receipts table id`, {
      vaultId: vault.id
    })
  }
  return {
    receiptsTableId: normalizeSuiAddress(id),
    lockingTimeForWithdrawMs: Number(json?.locking_time_for_withdraw ?? 0)
  }
}

/**
 * True when a gRPC error means "no such dynamic field" rather than a transport failure.
 *
 * @param error - The caught error to classify
 * @returns True for a NOT_FOUND status, in either its string or numeric form
 */
function isGrpcNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'NOT_FOUND' || code === 5
}

/**
 * Receipt state for one receipt; a receipt without a table entry is empty, not an error.
 *
 * @param client - gRPC client used to fetch the dynamic field
 * @param receiptsTableId - Id of the vault's `receipts` table, from {@link readVoloVaultView}
 * @param receiptId - Receipt object id, the table key
 * @returns Promise of the receipt's status, shares, pending withdraw shares, and last deposit
 *          time; all-zero defaults when the receipt has no entry yet
 * @throws VaultSdkError with code `CHAIN_QUERY_FAILED` on any error other than NOT_FOUND
 */
async function readReceiptState(
  client: SuiGrpcClient,
  receiptsTableId: string,
  receiptId: string
): Promise<typeof EMPTY_RECEIPT_STATE> {
  try {
    const { dynamicField } = await client.getDynamicField({
      parentId: receiptsTableId,
      name: {
        type: 'address',
        bcs: bcs.Address.serialize(receiptId).toBytes()
      }
    })
    const bytes = dynamicField.value?.bcs
    if (!bytes) return EMPTY_RECEIPT_STATE
    const parsed = VaultReceiptInfoStruct.parse(Uint8Array.from(bytes))
    return {
      status: parsed.status,
      shares: BigInt(parsed.shares),
      pendingWithdrawShares: BigInt(parsed.pending_withdraw_shares),
      lastDepositTime: Number(parsed.last_deposit_time)
    }
  } catch (error) {
    // Only a NOT_FOUND status code means "no entry yet". Matching on message text would
    // also swallow gateway 404s and misreport a funded receipt as empty.
    if (isGrpcNotFound(error)) {
      return EMPTY_RECEIPT_STATE
    }
    throw vaultErrors.chainQueryFailed('reading a Volo receipt state', error, {
      receiptsTableId,
      receiptId
    })
  }
}

/**
 * The receipt object ids `owner` holds for `vault`.
 *
 * Object ownership is the only link from a wallet to its receipts — the vault itself keys
 * everything by receipt address and never records who holds one. A receipt deposited into
 * another vault as a defi asset (`receipt_adaptor`) therefore drops out of this list while
 * its share balance keeps living in the vault.
 *
 * @param client - gRPC client used to page through owned objects
 * @param vault - Vault to filter receipts by; receipts for other vaults are skipped
 * @param owner - Sui address holding the receipts
 * @returns Promise<string[]> - Normalized receipt object ids, in the order the node paged them
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
 * Lists an owner's receipts for a vault together with the vault view the PTB builders need.
 *
 * Receipt state is read from the vault's on-chain `receipts` Table. Receipt objects only
 * contain their vault id; balance, status, and the withdraw-lock timestamp live in this
 * dynamic field. `view` is `null` when the owner holds no receipts — nothing needed it.
 *
 * Use this over {@link getVaultReceipts} when you also need the withdraw lock, which is what
 * makes a receipt's `lastDepositTime` interpretable.
 *
 * @param vault - The Volo vault to read receipts for. Must carry `vault.volo` config
 * @param owner - Sui address holding the receipts
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise of the owner's receipts and the vault view they were read against;
 *          `{ view: null, receipts: [] }` when the owner holds none
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault,
 *         `CHAIN_DATA_INVALID` when the vault exposes no receipts table, or
 *         `CHAIN_QUERY_FAILED` when a receipt state read fails
 */
export async function getVaultReceiptsWithView(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
  }
): Promise<{ view: VoloVaultView | null; receipts: VaultReceipt[] }> {
  checkVault(vault)
  const client = getSuiClient(options?.client)

  const found = await listOwnedReceiptIds(client, vault, owner)

  if (found.length === 0) {
    return { view: null, receipts: [] }
  }

  const view = await readVoloVaultView(client, vault)
  const states = await Promise.all(
    found.map((receiptId) => readReceiptState(client, view.receiptsTableId, receiptId))
  )

  return {
    view,
    receipts: found.map((id, index) => ({
      id,
      ...states[index]
    }))
  }
}

/**
 * Lists an owner's receipts for a vault, each with its share balance and status.
 *
 * Thin wrapper over {@link getVaultReceiptsWithView} that drops the vault view. Prefer that
 * one if you also need the withdraw lock.
 *
 * @param vault - The Volo vault to read receipts for. Must carry `vault.volo` config
 * @param owner - Sui address holding the receipts
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<VaultReceipt[]> - One entry per owned receipt for this vault. Empty when the
 *          owner holds none
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when `vault` is not a Volo vault,
 *         `CHAIN_DATA_INVALID` when the vault exposes no receipts table, or
 *         `CHAIN_QUERY_FAILED` when a receipt state read fails
 */
export async function getVaultReceipts(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
  }
): Promise<VaultReceipt[]> {
  const { receipts } = await getVaultReceiptsWithView(vault, owner, options)
  return receipts
}

/**
 * Plans per-receipt `withdraw_with_auto_transfer` calls in SHARE units.
 *
 * Callers must pre-filter to receipts the contract will accept (see
 * {@link canRequestWithdraw} and the withdraw lock) — the planner only sizes the calls.
 * The contract aborts on zero-share withdrawals, so the plan never contains one, and a
 * non-zero `shortfall` (or an empty plan) must be treated as an insufficient-balance
 * error by the caller instead of silently withdrawing less than requested.
 *
 * Receipts are consumed smallest-first, which keeps the number of requests down by retiring
 * dust receipts before touching a large one.
 *
 * @param receipts - Eligible receipts to draw from, already filtered by the caller. Not
 *        mutated; zero-share entries are skipped
 * @param shares - Total shares to withdraw
 * @returns The plan — receipts with `shares` overwritten by the amount to draw from each —
 *          plus the `shortfall` still uncovered after consuming every receipt
 */
export function planReceiptWithdraw(
  receipts: VaultReceipt[],
  shares: bigint
): { plans: VaultReceipt[]; shortfall: bigint } {
  const available = [...receipts]
    .filter((receipt) => receipt.shares > 0n)
    .sort((a, b) => (a.shares < b.shares ? -1 : a.shares > b.shares ? 1 : 0))

  const plans: VaultReceipt[] = []
  let remaining = shares

  for (const receipt of available) {
    if (remaining === 0n) break
    if (remaining >= receipt.shares) {
      plans.push(receipt)
      remaining -= receipt.shares
    } else {
      plans.push({
        ...receipt,
        shares: remaining
      })
      remaining = 0n
    }
  }

  return { plans, shortfall: remaining }
}
