import { bcs } from '@mysten/sui/bcs'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Vault } from '../../types'
import { getSuiClient } from '../../utils'
import { checkVault } from './utils'
import { listOwnedReceiptIds } from './receipt'

/** `volo_vault::deposit_request::DepositRequest`, in declaration order. */
const DepositRequestStruct = bcs.struct('DepositRequest', {
  requestId: bcs.u64(),
  receiptId: bcs.Address,
  recipient: bcs.Address,
  vaultId: bcs.Address,
  amount: bcs.u64(),
  expectedShares: bcs.u256(),
  requestTime: bcs.u64()
})

/** `volo_vault::withdraw_request::WithdrawRequest`, in declaration order. */
const WithdrawRequestStruct = bcs.struct('WithdrawRequest', {
  requestId: bcs.u64(),
  receiptId: bcs.Address,
  recipient: bcs.Address,
  vaultId: bcs.Address,
  shares: bcs.u256(),
  expectedAmount: bcs.u64(),
  requestTime: bcs.u64()
})

const ZERO_ADDRESS = normalizeSuiAddress('0x0')

export type PendingRequestType = 'deposit' | 'withdraw'

/**
 * A deposit or withdraw request sitting in the vault's request buffer, waiting for an operator
 * to execute it.
 *
 * A request only exists while it is pending: `execute_*` and `cancel_*` both remove it from the
 * buffer, so anything listed here is still outstanding.
 */
export type PendingRequest = {
  /** `u64` request id, vault-wide and per type. What the `cancel_*` entrypoints take. */
  requestId: bigint
  type: PendingRequestType
  vaultId: string
  /** The address the request was queried for, echoed back so merged lists stay attributable. */
  owner: string
  /** Receipt the request settles into. The `cancel_*` entrypoints take this object too. */
  receiptId: string
  /**
   * Where the request pays out: the wallet that submitted it for a deposit or an
   * auto-transfer withdraw, and `0x0…0` for a plain `withdraw`, which leaves the principal
   * as `claimable_principal` on the receipt instead of sending it anywhere.
   */
  recipient: string
  /** Epoch milliseconds, straight from the on-chain `Clock` at request time. */
  requestTime: number
  /**
   * Epoch milliseconds before which `cancel_deposit` / `cancel_withdraw` abort:
   * `requestTime + vault.locking_time_for_cancel_request`. An operator can execute the
   * request at any point, including before this, so a cancel is never guaranteed.
   */
  cancellableAt: number
  /** Principal to be deposited, and the shares the caller declared as its floor. */
  deposit?: { amount: bigint; expectedShares: bigint }
  /** Shares to be burned, and the principal the caller declared as its floor. */
  withdraw?: { shares: bigint; expectedAmount: bigint }
}

/** The `request_buffer` tables and the cancel lock, as the gRPC JSON view of a Vault spells them. */
type RequestBufferView = {
  depositRequests: string
  withdrawRequests: string
  lockingTimeForCancelRequest: number
}

/**
 * A `Table`'s id out of the JSON view of a Move struct.
 *
 * gRPC renders a `Table`'s `UID` as a plain address; other API implementations nest it as
 * `{ id: { id } }`, so both are accepted rather than trusting one shape.
 */
function tableId(table: unknown, field: string): string {
  const id = (table as { id?: unknown } | undefined)?.id
  const raw = typeof id === 'string' ? id : (id as { id?: unknown } | undefined)?.id
  if (typeof raw !== 'string') {
    throw new Error(`volo vault object has no ${field} table id`)
  }
  return normalizeSuiAddress(raw)
}

/**
 * Reads the ids of the two request tables, plus the cancel lock, off the Vault object.
 *
 * The tables are read through the object's JSON view: their ids live inside `Vault.request_buffer`
 * and BCS-decoding the whole vault to reach them would mean modelling every asset table ahead of
 * it, for two addresses.
 */
async function readRequestBuffer(client: SuiGrpcClient, vault: Vault): Promise<RequestBufferView> {
  const { object } = await client.getObject({
    objectId: vault.id,
    include: { json: true }
  })

  const json = object.json as {
    request_buffer?: { deposit_requests?: unknown; withdraw_requests?: unknown }
    locking_time_for_cancel_request?: unknown
  } | null
  const buffer = json?.request_buffer
  if (!buffer) {
    throw new Error(`volo vault ${vault.id} has no request_buffer`)
  }

  return {
    depositRequests: tableId(buffer.deposit_requests, 'deposit_requests'),
    withdrawRequests: tableId(buffer.withdraw_requests, 'withdraw_requests'),
    lockingTimeForCancelRequest: Number(json?.locking_time_for_cancel_request ?? 0)
  }
}

/**
 * Every entry of one request table.
 *
 * The table holds only pending requests, so this enumerates the outstanding ones for the whole
 * vault — a few dozen in practice — and the caller narrows them down to one wallet. There is no
 * cheaper path: the vault keeps no wallet index, and the gRPC client exposes no event query to
 * replay `DepositRequested` / `WithdrawRequested` from.
 */
async function listRequestTable<T>(
  client: SuiGrpcClient,
  parentId: string,
  valueType: string,
  parse: (bytes: Uint8Array) => T
): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null | undefined

  do {
    const page = await client.listDynamicFields({
      parentId,
      cursor,
      include: { value: true }
    })

    for (const field of page.dynamicFields) {
      const bytes = field.value?.bcs
      if (!bytes) continue
      // Guards the hand-written layout below against a table that holds something else.
      if (!field.valueType?.endsWith(valueType)) {
        throw new Error(
          `volo vault request table ${parentId} holds ${field.valueType}, expected ${valueType}`
        )
      }
      rows.push(parse(Uint8Array.from(bytes)))
    }

    cursor = page.hasNextPage ? (page.cursor === cursor ? null : page.cursor) : null
  } while (cursor)

  return rows
}

/**
 * The deposit and withdraw requests a wallet has outstanding in a vault.
 *
 * Attribution goes through `recipient`, the address the request pays out to, which
 * `user_entry::deposit` and `user_entry::withdraw_with_auto_transfer` both set to the sender.
 * A plain `user_entry::withdraw` leaves it at `0x0…0`, so those are attributed by receipt
 * ownership instead — looked up only when such a request actually shows up, since it costs an
 * extra pass over the wallet's receipts.
 *
 * Cancelling one takes `requestId` and `receiptId` from the returned entry; `cancellableAt` says
 * when the vault's lock lets that through.
 */
export async function getPendingRequests(
  vault: Vault,
  owner: string,
  options?: {
    client?: SuiGrpcClient
    type?: PendingRequestType
  }
): Promise<PendingRequest[]> {
  checkVault(vault)
  const client = getSuiClient(options?.client)
  const ownerAddress = normalizeSuiAddress(owner)
  const vaultAddress = normalizeSuiAddress(vault.id)
  const buffer = await readRequestBuffer(client, vault)

  const wantDeposits = options?.type !== 'withdraw'
  const wantWithdraws = options?.type !== 'deposit'

  const [deposits, withdraws] = await Promise.all([
    wantDeposits
      ? listRequestTable(
          client,
          buffer.depositRequests,
          '::deposit_request::DepositRequest',
          (bytes) => DepositRequestStruct.parse(bytes)
        )
      : Promise.resolve([]),
    wantWithdraws
      ? listRequestTable(
          client,
          buffer.withdrawRequests,
          '::withdraw_request::WithdrawRequest',
          (bytes) => WithdrawRequestStruct.parse(bytes)
        )
      : Promise.resolve([])
  ])

  const rows: PendingRequest[] = [
    ...deposits.map((row) => ({
      requestId: BigInt(row.requestId),
      type: 'deposit' as const,
      vaultId: normalizeSuiAddress(row.vaultId),
      owner: ownerAddress,
      receiptId: normalizeSuiAddress(row.receiptId),
      recipient: normalizeSuiAddress(row.recipient),
      requestTime: Number(row.requestTime),
      cancellableAt: Number(row.requestTime) + buffer.lockingTimeForCancelRequest,
      deposit: {
        amount: BigInt(row.amount),
        expectedShares: BigInt(row.expectedShares)
      }
    })),
    ...withdraws.map((row) => ({
      requestId: BigInt(row.requestId),
      type: 'withdraw' as const,
      vaultId: normalizeSuiAddress(row.vaultId),
      owner: ownerAddress,
      receiptId: normalizeSuiAddress(row.receiptId),
      recipient: normalizeSuiAddress(row.recipient),
      requestTime: Number(row.requestTime),
      cancellableAt: Number(row.requestTime) + buffer.lockingTimeForCancelRequest,
      withdraw: {
        shares: BigInt(row.shares),
        expectedAmount: BigInt(row.expectedAmount)
      }
    }))
  ].filter((row) => row.vaultId === vaultAddress)

  const byRecipient = rows.filter((row) => row.recipient === ownerAddress)
  const unattributed = rows.filter((row) => row.recipient === ZERO_ADDRESS)

  const mine = byRecipient
  if (unattributed.length > 0) {
    const receiptIds = new Set(await listOwnedReceiptIds(client, vault, owner))
    mine.push(...unattributed.filter((row) => receiptIds.has(row.receiptId)))
  }

  // Oldest first: the buffer is drained in request order, so this is the order they settle in.
  return mine.sort(
    (a, b) =>
      a.requestTime - b.requestTime ||
      Number(a.requestId - b.requestId) ||
      (a.type < b.type ? -1 : 1)
  )
}
