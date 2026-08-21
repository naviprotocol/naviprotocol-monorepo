import { VaultSdkError } from '../errors'
import type { VaultModuleContext } from '../module-context'
import type { VaultApp } from '../types'
import type { VaultIdentifier } from '../vaults'
import type { GetPendingRequestsOptions, PendingRequest } from './types'

/** One entry of `GET /users/:address/requests`, as the Volo API returns it. */
type VoloRequestRow = {
  requestId?: string
  receiptId?: string
  vaultId?: string
  shares?: string
  amount?: string
  status?: string
  executeTime?: string
}

type VoloRequestsResponse = {
  deposits?: VoloRequestRow[]
  withdrawals?: VoloRequestRow[]
}

function vaultId(vault: VaultIdentifier): string {
  return typeof vault === 'string' ? vault : vault.id
}

/**
 * Whether an entry carries everything the SDK does with a request: the id and receipt the
 * cancel builders take, and the vault id the caller matches on.
 */
function isActionable(row: VoloRequestRow): boolean {
  return Boolean(row.requestId) && Boolean(row.receiptId) && Boolean(row.vaultId)
}

/**
 * Epoch milliseconds from the API's ISO instant.
 *
 * `Date.parse` answers `NaN` for anything it cannot read, which would travel silently
 * through arithmetic and comparisons, so an unreadable timestamp becomes 0.
 */
function parseInstant(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Requests the Volo API for `owner` and normalises them.
 *
 * NAVI Lending has no counterpart: it settles inside the caller's own transaction, so it
 * never holds a request. `astros` vaults are served by the Volo API too, so both apps read
 * the same endpoint and are filtered by vault afterwards.
 */
export async function getPendingRequests(
  context: VaultModuleContext,
  owner: string,
  options?: GetPendingRequestsOptions
): Promise<PendingRequest[]> {
  if (!owner) {
    throw new VaultSdkError('REQUEST_NOT_FOUND', 'An owner address is required.')
  }

  const apps: VaultApp[] = options?.app ?? ['navi', 'volo', 'astros']
  const eventual: VaultApp[] = ['volo', 'astros']
  if (!apps.some((app) => eventual.includes(app))) return []

  const body = await context.transport.get<VoloRequestsResponse>({
    service: 'volo',
    path: `/users/${owner}/requests`
  })

  const rows: { row: VoloRequestRow; type: 'deposit' | 'withdraw' }[] = [
    ...(body?.deposits ?? []).map((row) => ({ row, type: 'deposit' as const })),
    ...(body?.withdrawals ?? []).map((row) => ({ row, type: 'withdraw' as const }))
  ]

  const wanted = options?.vaults?.map(vaultId)
  return (
    rows
      .filter(({ type }) => options?.type === undefined || options.type === type)
      // Every field below is load-bearing: the request id and receipt are what the cancel
      // builders take, and the vault id is what the caller matches on. An entry missing any
      // of them is dropped rather than surfaced as one that fails on use.
      .filter(({ row }) => isActionable(row))
      .filter(({ row }) => wanted === undefined || wanted.includes(row.vaultId!))
      .map(({ row, type }) => ({
        requestId: row.requestId!,
        vaultId: row.vaultId!,
        owner,
        type,
        receiptId: row.receiptId!,
        requestTime: parseInstant(row.executeTime),
        ...(type === 'deposit'
          ? { deposit: { amount: row.amount ?? '0' } }
          : { withdraw: { shares: row.shares ?? '0' } })
      }))
  )
}
