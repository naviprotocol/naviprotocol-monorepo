import type { Pool } from '@naviprotocol/lending'
import type { MarketSnapshot, PositionAmounts, Strategy } from './types'
import { BN, check, decimal } from './utils'

/** NAVI stores lending balances/capacity at 9 decimals, independently of Coin<T>. */
export const LENDING_DECIMALS = 9

export function tokenDecimals(pool: Pick<Pool, 'token'>): number {
  const value = pool.token?.decimals
  check(
    Number.isInteger(value) && value >= 0 && value <= 18,
    'MARKET_UNSUPPORTED',
    'Token precision must be an integer from 0 to 18'
  )
  return value
}

export function lendingToRaw(value: string, decimals: number, roundUp = false) {
  return decimal(value)
    .shiftedBy(decimals - LENDING_DECIMALS)
    .integerValue(roundUp ? BN.ROUND_CEIL : BN.ROUND_FLOOR)
    .toFixed(0)
}

/** A custom source with a rounded-down zero cannot establish an empty Cap without the protocol amount. */
export function positionSides(position: PositionAmounts, market: MarketSnapshot) {
  const side = (amount: string, protocol: string | undefined, decimals: number, debt: boolean) => {
    if (protocol !== undefined) {
      check(
        /^(0|[1-9][0-9]{0,77})$/.test(protocol) &&
          lendingToRaw(protocol, decimals, debt) === amount,
        'READ_FAILED',
        'Invalid protocol balance or inconsistent native amount'
      )
      return protocol !== '0'
    }
    check(
      debt || decimals >= LENDING_DECIMALS || amount !== '0',
      'READ_FAILED',
      'Rounded collateral requires a protocol balance'
    )
    return amount !== '0'
  }
  return {
    collateral: side(
      position.collateralAmount,
      position.protocolCollateralAmount,
      tokenDecimals(market.collateral),
      false
    ),
    debt: side(position.debtAmount, position.protocolDebtAmount, tokenDecimals(market.debt), true)
  }
}

export function isDustClose(strategy: Strategy, position: PositionAmounts, market: MarketSnapshot) {
  return (
    strategy.allowCollateralDustClose === true &&
    tokenDecimals(market.collateral) === 6 &&
    position.collateralAmount === '0' &&
    position.debtAmount === '0' &&
    position.protocolDebtAmount === '0' &&
    typeof position.protocolCollateralAmount === 'string' &&
    /^[1-9][0-9]{0,2}$/.test(position.protocolCollateralAmount)
  )
}

/** Price of one native atom, used only inside the solver. Public prices stay USD/token. */
export function atomPrices(market: MarketSnapshot) {
  return {
    collateral: decimal(market.collateralPrice).shiftedBy(-tokenDecimals(market.collateral)),
    debt: decimal(market.debtPrice).shiftedBy(-tokenDecimals(market.debt))
  }
}

/** Existing one-micro-token interest/drift cushion, with at least one native atom. */
export function amountCushion(pool: Pick<Pool, 'token'>) {
  return BN.maximum(1, new BN(1).shiftedBy(tokenDecimals(pool) - 6))
}

export function supplyCapacity(market: MarketSnapshot) {
  return BN.maximum(
    0,
    new BN(market.collateral.leftSupply)
      .shiftedBy(tokenDecimals(market.collateral))
      .integerValue(BN.ROUND_FLOOR)
  )
}

export function borrowCapacity(market: MarketSnapshot) {
  return new BN(lendingToRaw(market.debt.availableBorrow, tokenDecimals(market.debt)))
}

/**
 * Pool cash of the debt reserve, raw in the coin's own decimals: the lending API's `balance` ("pool withdrawable
 * balance"). Not the `Pool<T>` object's balance: the SUI pool stakes most of its SUI and unstakes on withdrawal (LQ-09).
 */
export function reserveCash(market: MarketSnapshot) {
  const cash = (market.debt as { balance?: unknown }).balance
  check(
    typeof cash === 'string' && /^\d+$/.test(cash),
    'READ_FAILED',
    'Missing or invalid debt reserve cash'
  )
  return new BN(cash)
}

/**
 * LQ-01 / LQ-05..LQ-10: a main-market strategy flash-loans its debt coin from the same main-market reserve it borrows
 * from, and the flash is still outstanding when the borrow runs. The borrow alone uses borrow-cap headroom
 * (`availableBorrow`, checked separately); every coin taken out — flash, borrow and its fee — must be in the pool at once.
 * A flash-only exit at the borrow cap stays possible while the cash is there (LQ-04). Isolated markets borrow from their
 * own reserve (LQ-02): only the separate checks apply there.
 */
export function withinSameReserveCapacity(
  strategy: { market: string },
  amounts: { flashAmount: string; borrowAmount: string; borrowFee: string },
  market: MarketSnapshot
) {
  if (strategy.market !== 'main') return true
  const out = new BN(amounts.flashAmount).plus(amounts.borrowAmount).plus(amounts.borrowFee)
  return out.isZero() || out.lte(reserveCash(market))
}

/**
 * `maxLeverage` as enforced: the solver accepts a plan within 0.01% of its target and amounts are
 * whole atoms, so a target equal to the ceiling can land a hair above it. The quote, the live
 * rebuild and the on-chain check all allow that same band, and nothing beyond it.
 */
export const LEVERAGE_TOLERANCE = '0.0001'
export function leverageCeiling(maxLeverage: string) {
  return new BN(maxLeverage).times(new BN(1).plus(LEVERAGE_TOLERANCE))
}

/** A lowered borrowing cap must still permit repayment, collateral top-up and exit. */
export function withinLtv(
  projected: PositionAmounts,
  before: PositionAmounts,
  market: MarketSnapshot,
  allowReduction: boolean
) {
  const prices = atomPrices(market)
  const c = new BN(projected.collateralAmount),
    d = new BN(projected.debtAmount)
  if (
    d
      .times(prices.debt)
      .times(market.borrowWeight)
      .lte(c.times(prices.collateral).times(market.ltv))
  )
    return true
  return (
    allowReduction &&
    d.lte(before.debtAmount) &&
    d.times(before.collateralAmount).lte(new BN(before.debtAmount).times(c))
  )
}
