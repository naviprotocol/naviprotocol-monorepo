import { bcs } from '@mysten/sui/bcs'
import type { EMode, Market, Pool } from '@naviprotocol/lending'
import type {
  Action,
  ExecutionPlan,
  LendingConfig,
  MarketSnapshot,
  MultiplySuiClient,
  PositionAmounts,
  Strategy
} from './types'
import { BN, RAY, check } from './utils'

const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() })
const modeState = bcs.struct('Emode', {
  emodes_pair: table,
  user_emode_id: table,
  next_emode_id: bcs.u64()
})
const asset = bcs.struct('EmodeAsset', {
  assetId: bcs.u8(),
  isCollateral: bcs.bool(),
  isDebt: bcs.bool(),
  ltv: bcs.u256(),
  lt: bcs.u256(),
  liquidation_bonus: bcs.u256()
})
const pair = bcs.struct('EmodeConfig', { assetA: asset, assetB: asset, isActive: bcs.bool() })

/** A paused group is filtered out by Lending getMarket. Read only its configured ID;
 * never traverse account-mode rows or consult the independent E-Mode Registry. */
async function readConfiguredMode(
  client: MultiplySuiClient,
  config: LendingConfig,
  marketId: number,
  id: number
): Promise<EMode> {
  // EMODE_KEY was added by a later package upgrade than AccountCap. Its type origin
  // must come from this Storage's fields, not from the current or original package ID.
  let cursor: string | undefined
  let name: { type: string; bcs: Uint8Array } | undefined
  const seen = new Set<string>()
  do {
    const page = await client.core.listDynamicFields({ parentId: config.storage, cursor })
    name = page.dynamicFields.find((field) =>
      field.name.type.endsWith('::storage::EMODE_KEY')
    )?.name
    if (name || !page.hasNextPage) break
    check(page.cursor && !seen.has(page.cursor), 'READ_FAILED', 'Incomplete Storage fields')
    seen.add(page.cursor)
    cursor = page.cursor
  } while (true)
  check(name, 'MARKET_UNSUPPORTED', 'Market has no E-Mode configuration')
  const { dynamicField: state } = await client.core.getDynamicField({
    parentId: config.storage,
    name
  })
  const parsed = modeState.parse(state.value.bcs)
  check(
    BigInt(id) < BigInt(parsed.next_emode_id),
    'MARKET_UNSUPPORTED',
    'Unknown configured E-Mode'
  )
  const { dynamicField: row } = await client.core.getDynamicField({
    parentId: parsed.emodes_pair.id,
    name: { type: 'u64', bcs: bcs.u64().serialize(id).toBytes() }
  })
  const group = pair.parse(row.value.bcs)
  return {
    emodeId: id,
    marketId,
    uniqueId: `${marketId}-${id}`,
    isActive: group.isActive,
    assets: [group.assetA, group.assetB].map((a) => ({
      ...a,
      ltv: new BN(a.ltv).div(RAY.toString()).toNumber(),
      lt: new BN(a.lt).div(RAY.toString()).toNumber(),
      bonus: new BN(a.liquidation_bonus).div(RAY.toString()).toNumber()
    }))
  }
}

export async function resolveEMode(
  client: MultiplySuiClient,
  strategy: Strategy,
  config: LendingConfig,
  market: Market,
  collateral: Pool,
  debt: Pool
): Promise<EMode | undefined> {
  if (strategy.emodeId === undefined) return undefined
  check(
    Number.isSafeInteger(strategy.emodeId) && strategy.emodeId >= 0,
    'INVALID_ARGUMENT',
    'E-Mode ID must be a nonnegative safe integer'
  )
  check(market.config.key === strategy.market, 'MARKET_UNSUPPORTED', 'E-Mode market mismatch')
  const listed = market.getEMode(strategy.emodeId)
  const mode =
    listed ?? (await readConfiguredMode(client, config, market.config.id, strategy.emodeId))
  // A missing active group is not a supported discovery route (e.g. an obsolete API catalogue).
  check(
    listed || !mode.isActive,
    'MARKET_UNSUPPORTED',
    'Active E-Mode missing from market catalogue'
  )
  const c = mode.assets.find((a) => a.assetId === collateral.id)
  const d = mode.assets.find((a) => a.assetId === debt.id)
  check(
    mode.emodeId === strategy.emodeId &&
      mode.marketId === market.config.id &&
      typeof mode.isActive === 'boolean' &&
      new Set(mode.assets.map((a) => a.assetId)).size === mode.assets.length &&
      c?.isCollateral === true &&
      d?.isDebt === true,
    'MARKET_UNSUPPORTED',
    'E-Mode does not support this market and asset direction'
  )
  check(
    new BN(c.ltv).isFinite() &&
      new BN(c.ltv).gt(0) &&
      new BN(c.ltv).lte(c.lt) &&
      new BN(c.lt).isFinite() &&
      new BN(c.lt).lte(1),
    'READ_FAILED',
    'Invalid E-Mode risk parameters'
  )
  return mode
}

export function validateMarketMode(strategy: Strategy, market: MarketSnapshot) {
  check(
    strategy.emodeId === undefined
      ? market.emode === undefined
      : market.emode?.id === strategy.emodeId && typeof market.emode.active === 'boolean',
    'READ_FAILED',
    'Market snapshot does not match configured E-Mode'
  )
}

/**
 * RV-08: the snapshot's LTV/LT are those of `strategy.emodeId`, so they describe a position only
 * while its lending account is in that mode. A source that does not report the account mode
 * (`undefined`) is taken at its word, as before.
 */
export function inStrategyMode(strategy: Strategy, position: PositionAmounts) {
  const actual = position.accountEmodeId
  if (strategy.emodeId === undefined || actual === undefined) return true
  check(
    actual === null || (Number.isSafeInteger(actual) && actual >= 0),
    'READ_FAILED',
    'Invalid account E-Mode'
  )
  return actual === strategy.emodeId
}

const OUTSIDE_MODE = 'Lending account is not in the strategy E-Mode'
/** A position outside the strategy mode has other risk parameters than every figure quoted for it. */
export function assertPositionMode(strategy: Strategy, position: PositionAmounts, empty: boolean) {
  check(empty || inStrategyMode(strategy, position), 'POSITION_UNSUPPORTED', OUTSIDE_MODE)
}

/**
 * True when an empty account in no mode has to enter the strategy mode before an open. An account
 * that holds a position outside the mode, or sits in another mode, is refused.
 */
export function mustEnterMode(strategy: Strategy, position: PositionAmounts, empty: boolean) {
  if (inStrategyMode(strategy, position)) return false
  check(empty && position.accountEmodeId === null, 'POSITION_UNSUPPORTED', OUTSIDE_MODE)
  return true
}

export function assertModeExposure(
  action: Action,
  execution: Pick<ExecutionPlan, 'borrowAmount'>,
  market: MarketSnapshot
) {
  check(
    market.emode?.active !== false ||
      (action.type !== 'open' &&
        action.type !== 'add_principal' &&
        BigInt(execution.borrowAmount) === 0n),
    'MARKET_UNSUPPORTED',
    'E-Mode is paused; new exposure is disabled'
  )
}
