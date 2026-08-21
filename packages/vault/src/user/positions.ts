import { VaultSdkError } from '../errors'
import type { VaultModuleContext } from '../module-context'
import { unwrapList } from '../transport'
import type { VaultApp } from '../types'
import type { GetPositionsOptions, VaultUserPosition } from './types'

/**
 * One row of `/users/:address/position`.
 *
 * The two services agree on the first eight fields and diverge after that. `protocol` is
 * the app the vault is branded as, not `VaultProtocol` — NAVI's service always says `navi`,
 * while Volo's says `volo`, `astros` or `navi`, because a NAVI-branded vault can run on the
 * Volo contract.
 */
type PositionRow = {
  vaultId?: string
  protocol?: string
  shares?: number
  poolShareTokenBalance?: number
  poolShareTokenUsd?: number
  vaultApr?: number
  yieldLifetimeAmount?: number
  yieldLifetimeUsd?: number

  // NAVI only.
  coinType?: string
  coinSymbol?: string
  coinDecimals?: number
  coinIconUrl?: string
  coinPrice?: number
  claimableRewardsUsd?: number
  yieldBreakdown?: {
    realizedUsd?: number
    unrealizedUsd?: number
    claimedUsd?: number
    claimableUsd?: number
  }

  // Volo only. `tokenPrice` is `coinPrice` under another name.
  pendingDeposit?: number
  tokenPrice?: number
}

const ALL_APPS: VaultApp[] = ['navi', 'volo', 'astros']

function isApp(value: string | undefined): value is VaultApp {
  return value === 'navi' || value === 'volo' || value === 'astros'
}

/**
 * Maps one row onto the unified shape.
 *
 * Fields both services report are lifted to the top level; the rest are grouped under the
 * service that reported them, so a caller reading `position.volo?.pendingDeposit` is also
 * being told which service the row came from.
 */
function toPosition(
  row: PositionRow & { vaultId: string },
  owner: string,
  service: 'navi' | 'volo'
): VaultUserPosition {
  return {
    vaultId: row.vaultId,
    owner,
    shares: row.shares ?? 0,
    amount: row.poolShareTokenBalance ?? 0,
    amountUsd: row.poolShareTokenUsd,
    apr: row.vaultApr ?? 0,
    yieldLifetimeAmount: row.yieldLifetimeAmount ?? 0,
    yieldLifetimeUsd: row.yieldLifetimeUsd ?? 0,
    coinPrice: service === 'navi' ? row.coinPrice : row.tokenPrice,
    ...(service === 'navi'
      ? {
          navi: {
            coinType: row.coinType,
            coinSymbol: row.coinSymbol,
            coinDecimals: row.coinDecimals,
            coinIconUrl: row.coinIconUrl,
            claimableRewardsUsd: row.claimableRewardsUsd,
            yieldBreakdown: row.yieldBreakdown
          }
        }
      : { volo: { pendingDeposit: row.pendingDeposit } })
  }
}

/**
 * A holder's positions across both services.
 *
 * NAVI's service serves only `navi` vaults; Volo's serves `volo`, `astros` and the NAVI
 * vaults that run on its contract, so asking for `navi` alone still reads both.
 */
export async function getPositions(
  context: VaultModuleContext,
  owner: string,
  options?: GetPositionsOptions
): Promise<VaultUserPosition[]> {
  if (!owner) {
    throw new VaultSdkError('REQUEST_NOT_FOUND', 'An owner address is required.')
  }

  const apps = options?.app ?? ALL_APPS
  if (apps.length === 0) return []

  const path = `/users/${owner}/position`
  const wantedVaults = options?.vaults?.map((vault) =>
    typeof vault === 'string' ? vault : vault.id
  )

  const [naviRows, voloRows] = await Promise.all([
    apps.includes('navi')
      ? context.transport
          .get<unknown>({ service: 'navi', path })
          .then((body) => unwrapList<PositionRow>(body, `GET navi ${path}`))
      : [],
    context.transport
      .get<unknown>({ service: 'volo', path })
      .then((body) => unwrapList<PositionRow>(body, `GET volo ${path}`))
  ])

  const rows: { row: PositionRow; service: 'navi' | 'volo' }[] = [
    // NAVI's service has no other kind of vault, so its rows need no app check.
    ...naviRows.map((row) => ({ row, service: 'navi' as const })),
    ...voloRows
      .filter((row) => apps.includes(isApp(row.protocol) ? row.protocol : 'volo'))
      .map((row) => ({ row, service: 'volo' as const }))
  ]

  return rows
    .filter(
      (entry): entry is { row: PositionRow & { vaultId: string }; service: 'navi' | 'volo' } =>
        Boolean(entry.row.vaultId)
    )
    .filter(({ row }) => wantedVaults === undefined || wantedVaults.includes(row.vaultId))
    .map(({ row, service }) => toPosition(row, owner, service))
}
