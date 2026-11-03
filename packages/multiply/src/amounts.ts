import type { Pool } from '@naviprotocol/lending'
import type { MarketSnapshot, PositionAmounts } from './types'
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
