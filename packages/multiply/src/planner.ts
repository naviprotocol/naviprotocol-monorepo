import type {
  Action,
  Constraints,
  ConversionQuote,
  ConversionRequest,
  Converter,
  ExecutionPlan,
  MarketSnapshot,
  PositionAmounts,
  Strategy
} from './types'
import { BN, ceil, check, decimal, floor, uint, MultiplyError } from './utils'
import { validateConversion } from './converters'
import { amountCushion, atomPrices, borrowCapacity, supplyCapacity, withinLtv } from './amounts'

type N = InstanceType<typeof BN>
const n = (v: string | number) => new BN(v)
export function metrics(position: PositionAmounts, market: MarketSnapshot) {
  const prices = atomPrices(market)
  const c = n(position.collateralAmount).times(prices.collateral)
  const d = n(position.debtAmount).times(prices.debt)
  const equity = c.minus(d)
  return {
    healthFactor: d.isZero()
      ? null
      : c.times(market.liquidationThreshold).div(d.times(market.borrowWeight)).toFixed(12),
    leverage: c.isZero() && d.isZero() ? null : equity.lte(0) ? null : c.div(equity).toFixed(12)
  }
}
export function validateAction(action: Action, constraints: Constraints) {
  check(
    [
      'open',
      'add_principal',
      'remove_principal',
      'set_leverage',
      'repay',
      'add_collateral',
      'close'
    ].includes(action?.type),
    'INVALID_ARGUMENT',
    'Unknown Multiply action'
  )
  if (
    ['open', 'add_principal', 'remove_principal', 'repay', 'add_collateral'].includes(action.type)
  ) {
    check('amount' in action, 'INVALID_ARGUMENT', 'This action requires an amount')
    uint(action.amount, false)
  }
  if (action.type === 'open' || action.type === 'set_leverage') decimal(action.targetLeverage, '1')
  if ('targetLeverage' in action && action.targetLeverage !== undefined)
    decimal(action.targetLeverage, '1')
  check(
    Number.isInteger(constraints?.maxSlippageBps) &&
      constraints.maxSlippageBps >= 0 &&
      constraints.maxSlippageBps < 10000,
    'INVALID_ARGUMENT',
    'Slippage must be integer bps in [0, 10000)'
  )
  decimal(constraints.minHealthFactor, '1')
  if (constraints.maxLeverage !== undefined) decimal(constraints.maxLeverage, '1')
}
export async function chooseConversion(
  req: ConversionRequest,
  converters: Converter[],
  fallback: Converter
): Promise<ConversionQuote> {
  const eligible = converters.filter((c) => c.supports(req.coinIn, req.coinOut))
  const results = await Promise.allSettled(eligible.map((c) => c.quote(req)))
  const quotes: ConversionQuote[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'fulfilled') {
      validateConversion(result.value, req, eligible[i].id)
      quotes.push(result.value)
    }
  }
  if (quotes.length)
    return quotes.sort((a, b) => {
      const comparison = n(b.minOutput.amount).comparedTo(a.minOutput.amount)
      return comparison || a.converterId.localeCompare(b.converterId)
    })[0]
  check(
    fallback.supports(req.coinIn, req.coinOut),
    'NO_CONVERSION_ROUTE',
    'No converter supports this pair'
  )
  try {
    const q = await fallback.quote(req)
    validateConversion(q, req, fallback.id)
    return q
  } catch (error) {
    throw new MultiplyError(
      'NO_CONVERSION_ROUTE',
      `All eligible converters failed; fallback: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
export async function plan(
  strategy: Strategy,
  action: Action,
  constraints: Constraints,
  snapshot: PositionAmounts,
  market: MarketSnapshot,
  borrowFeeBps: string,
  convert: (req: ConversionRequest) => Promise<ConversionQuote>
) {
  const C = n(snapshot.collateralAmount),
    D = n(snapshot.debtAmount)
  const { collateral: pc, debt: pd } = atomPrices(market)
  check(
    pc.gt(0) &&
      pd.gt(0) &&
      decimal(market.ltv).lte(1) &&
      decimal(market.liquidationThreshold).lte(1) &&
      decimal(market.borrowWeight).gte(1),
    'READ_FAILED',
    'Invalid market risk or price data'
  )
  const equity = C.times(pc).minus(D.times(pd))
  check(
    (C.isZero() && D.isZero()) || equity.gt(0),
    'POSITION_UNSUPPORTED',
    'Position has non-positive equity'
  )
  const current = metrics(snapshot, market)
  const specified = 'targetLeverage' in action ? action.targetLeverage : undefined
  const target = decimal(specified ?? current.leverage ?? '1', '1')
  if (action.type === 'set_leverage')
    check(
      target
        .minus(current.leverage ?? '1')
        .abs()
        .gt('0.000001'),
      'NO_OP',
      'Position already has the requested leverage'
    )
  uint(borrowFeeBps)
  uint(market.flash.feeBps)
  check(
    Number.isSafeInteger(market.observedAt) &&
      Date.now() - market.observedAt <= 120_000 &&
      market.observedAt <= Date.now() + 5000,
    'STALE_QUOTE',
    'Market snapshot is stale'
  )
  if (constraints.maxLeverage)
    check(target.lte(constraints.maxLeverage), 'CONSTRAINT_VIOLATION', 'Target exceeds maxLeverage')
  const inputs: { coinType: string; amount: string }[] = [],
    outputs: typeof inputs = [],
    minOutputs: typeof inputs = []
  const result: Omit<ExecutionPlan, 'accountCap' | 'capRegistry' | 'checksum'> = {
    version: 3,
    snapshot,
    market,
    conversions: [],
    direction: 'increase',
    flashAmount: '0',
    flashRepayment: '0',
    borrowAmount: '0',
    borrowFee: '0',
    withdrawAmount: '0',
    collateralAfter: C.toFixed(0),
    debtAfter: D.toFixed(0),
    minCollateralAfter: C.toFixed(0)
  }
  const flashRepay = (v: N) => n(ceil(v.times(n(market.flash.feeBps).div(10000).plus(1))))
  const borrowFee = (v: N) => n(floor(v.times(borrowFeeBps).div(10000)))
  const targetReached = (c: N, d: N) => {
    const value = c.times(pc),
      net = value.minus(d.times(pd))
    return net.gt(0) && value.div(net).minus(target).abs().lte(target.times('0.0001'))
  }
  // Leave time for the API's other reads within its quote deadline. An abandoned
  // converter promise is read-only; late results are never used in the plan.
  const conversionDeadline = Date.now() + 45_000
  let conversionCount = 0
  const request = async (amount: string, increase: boolean) => {
    const remaining = conversionDeadline - Date.now()
    check(
      ++conversionCount <= 32 && remaining > 0,
      'NO_CONVERGENCE',
      'Conversion quote budget exhausted'
    )
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        convert({
          amountIn: amount,
          coinIn: increase ? strategy.debtCoinType : strategy.collateralCoinType,
          coinOut: increase ? strategy.collateralCoinType : strategy.debtCoinType,
          slippageBps: constraints.maxSlippageBps
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new MultiplyError('NO_CONVERGENCE', 'Conversion quote time budget exhausted')),
            remaining
          )
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
  const input = (coinType: string, amount: string) => inputs.push({ coinType, amount })
  if (action.type === 'repay' || action.type === 'add_collateral') {
    result.direction = action.type
    input(
      action.type === 'repay' ? strategy.debtCoinType : strategy.collateralCoinType,
      action.amount
    )
    if (action.type === 'repay') {
      result.debtAfter = BN.maximum(0, D.minus(action.amount)).toFixed(0)
      const change = BN.maximum(0, n(action.amount).minus(D)).toFixed(0)
      if (change !== '0') outputs.push({ coinType: strategy.debtCoinType, amount: change })
    } else result.collateralAfter = result.minCollateralAfter = C.plus(action.amount).toFixed(0)
  } else if (
    action.type === 'open' ||
    action.type === 'add_principal' ||
    (action.type === 'set_leverage' && target.gt(current.leverage ?? '1'))
  ) {
    const P = n('amount' in action ? action.amount : '0')
    if (P.gt(0)) input(strategy.principalCoinType, P.toFixed(0))
    const evaluation = async (F: N) => {
      const q = await request(P.plus(F).toFixed(0), true)
      const repayment = flashRepay(F),
        fee = borrowFee(repayment)
      const c = C.plus(q.expectedOutput.amount),
        d = D.plus(repayment).plus(fee)
      return {
        q,
        F,
        repayment,
        fee,
        c,
        d,
        residual: d.times(pd).minus(c.times(pc).times(target.minus(1)).div(target))
      }
    }
    const initialHi = n(
      ceil(equity.plus(P.times(pd)).times(target.minus(1)).div(pd).times(2).plus(1))
    )
    let lo = n(0),
      hi = initialHi
    let best: Awaited<ReturnType<typeof evaluation>> | undefined
    let upper: Awaited<ReturnType<typeof evaluation>>
    let lowerResidual = n(0)
    const bracket = async () => {
      lo = n(0)
      hi = initialHi
      best = P.gt(0) ? await evaluation(lo) : undefined
      if (best && targetReached(best.c, best.d)) return true
      check(
        !best || best.residual.lt(0),
        'ACTION_UNSUPPORTED',
        'This contribution requires deleveraging; use set_leverage separately'
      )
      lowerResidual =
        best?.residual ?? D.times(pd).minus(C.times(pc).times(target.minus(1)).div(target))
      upper = await evaluation(hi)
      for (let i = 0; upper.residual.lt(0) && i < 4; i++) {
        if (targetReached(upper.c, upper.d)) break
        hi = hi.times(2)
        upper = await evaluation(hi)
      }
      if (targetReached(upper.c, upper.d)) {
        best = upper
        return true
      }
      check(upper.residual.gte(0), 'NO_CONVERGENCE', 'Could not bracket leverage')
      return false
    }
    let converged = await bracket()
    let refreshes = 0,
      stagnant = 0,
      previousResidual: N | undefined
    for (let i = 0; !converged && i < 24; i++) {
      const span = hi.minus(lo)
      const guess = n(
        floor(
          lo.plus(span.times(lowerResidual.negated()).div(upper!.residual.minus(lowerResidual)))
        )
      )
      const F = BN.maximum(lo.plus(1), BN.minimum(hi, guess))
      best = await evaluation(F)
      converged = targetReached(best.c, best.d)
      if (converged) break
      const residual = best.residual.abs()
      stagnant = previousResidual && residual.gte(previousResidual.times('0.9')) ? stagnant + 1 : 0
      previousResidual = residual
      // Quotes sampled at different times can bracket a root that no longer
      // exists. Never accept a one-atom interval without checking the actual
      // latest quote; refresh both endpoints on collapse or stalled progress.
      if (span.lte(1) || stagnant >= 3) {
        check(
          refreshes < 2,
          'NO_CONVERGENCE',
          'Conversion quotes could not achieve the requested leverage within tolerance'
        )
        refreshes++
        converged = await bracket()
        stagnant = 0
        previousResidual = undefined
      } else if (best.residual.lt(0)) {
        lo = F
        lowerResidual = best.residual
      } else {
        hi = F
        upper = best
      }
    }
    check(
      converged && best,
      'NO_CONVERGENCE',
      'Conversion quotes could not achieve the requested leverage within tolerance'
    )
    result.conversions = [best.q]
    result.flashAmount = best.F.toFixed(0)
    result.flashRepayment = result.borrowAmount = best.repayment.toFixed(0)
    result.borrowFee = best.fee.toFixed(0)
    result.collateralAfter = best.c.toFixed(0)
    result.minCollateralAfter = C.plus(best.q.minOutput.amount).toFixed(0)
    result.debtAfter = best.d.toFixed(0)
  } else {
    result.direction = 'decrease'
    check(C.gt(0), 'POSITION_NOT_FOUND', 'No collateral to withdraw')
    const close = action.type === 'close'
    const payout = n(action.type === 'remove_principal' ? action.amount : 0)
    check(
      payout.times(pd).lt(equity) || close,
      'CONSTRAINT_VIOLATION',
      'Withdrawal consumes all equity; use close'
    )
    // Repay a small interest reserve when clearing debt. Actual excess is returned by NAVI.
    const fullRepay = D.isZero() ? D : n(ceil(D.times('1.0001').plus(amountCushion(market.debt))))
    const evaluation = async (W: N) => {
      const q = await request(W.toFixed(0), false)
      const available = n(q.minOutput.amount).minus(payout)
      const R =
        close || target.eq(1)
          ? fullRepay
          : BN.minimum(D, n(floor(available.div(n(market.flash.feeBps).div(10000).plus(1)))))
      const d = BN.maximum(0, D.minus(R)),
        c = C.minus(W)
      return {
        q,
        W,
        R,
        repayment: flashRepay(R),
        c,
        d,
        residual: d.times(pd).minus(c.times(pc).times(target.minus(1)).div(target)),
        available
      }
    }
    let best
    if (close) best = await evaluation(C)
    else {
      // Estimate using oracle prices, then correct with the actual conversion minimum and fees.
      let W = n(
        ceil(
          D.times(pd)
            .minus(C.times(pc).times(target.minus(1)).div(target))
            .plus(payout.times(pd))
            .times(target)
            .div(pc)
        )
      )
      if (target.eq(1)) W = n(ceil(fullRepay.plus(payout).times(pd).div(pc).times('1.01')))
      W = BN.maximum(1, BN.minimum(C, W))
      for (let i = 0; i < 20; i++) {
        best = await evaluation(W)
        const shortfall = best.repayment.plus(payout).minus(best.q.minOutput.amount)

        // Use remaining equity, as large withdrawals can make the original
        // position's value-based residual tolerance far too permissive.
        if (best.R.gte(0) && shortfall.lte(0) && targetReached(best.c, best.d)) break
        const delta = target.eq(1)
          ? shortfall.times(pd).div(pc)
          : best.residual.times(target).div(pc)
        const next = BN.maximum(
          1,
          n(ceil(W.plus(delta.times('1.01')).plus(shortfall.gt(0) ? 1 : 0)))
        )
        check(
          next.lt(C) && !next.eq(W) && i < 19,
          'NO_CONVERGENCE',
          'No feasible deleverage route within constraints'
        )
        W = next
      }
    }
    check(best && best.R.gte(0), 'NO_CONVERGENCE', 'Missing decrease plan')
    const excessRepay = BN.maximum(0, best.R.minus(D))
    const output = n(best.q.expectedOutput.amount).plus(excessRepay).minus(best.repayment)
    const minOutput = n(best.q.minOutput.amount).minus(best.repayment)
    check(
      minOutput.gte(payout) && minOutput.gte(0),
      'CONSTRAINT_VIOLATION',
      'Conversion cannot cover flash repayment and withdrawal'
    )
    result.conversions = [best.q]
    result.flashAmount = best.R.toFixed(0)
    result.flashRepayment = best.repayment.toFixed(0)
    result.withdrawAmount = best.W.toFixed(0)
    result.collateralAfter = result.minCollateralAfter = best.c.toFixed(0)
    result.debtAfter = best.d.toFixed(0)
    if (output.gt(0)) outputs.push({ coinType: strategy.principalCoinType, amount: floor(output) })
    if (minOutput.gt(0))
      minOutputs.push({ coinType: strategy.principalCoinType, amount: floor(minOutput) })
  }
  for (const amount of [
    result.flashAmount,
    result.flashRepayment,
    result.borrowAmount,
    result.borrowFee,
    result.withdrawAmount,
    result.collateralAfter,
    result.debtAfter
  ])
    uint(amount)
  const f = n(result.flashAmount)
  check(
    f.isZero() || (f.gte(market.flash.min) && f.lte(market.flash.max)),
    'CAPACITY_EXCEEDED',
    'Flash liquidity limit exceeded'
  )
  check(
    n(result.borrowAmount).plus(result.borrowFee).lte(borrowCapacity(market)),
    'CAPACITY_EXCEEDED',
    'Borrow liquidity limit exceeded'
  )
  check(
    n(result.collateralAfter).minus(C).lte(supplyCapacity(market)),
    'CAPACITY_EXCEEDED',
    'Supply capacity exceeded'
  )
  const projected = { collateralAmount: result.collateralAfter, debtAmount: result.debtAfter }
  const conservative = metrics(
    { ...projected, collateralAmount: result.minCollateralAfter },
    market
  )
  check(
    conservative.healthFactor === null ||
      n(conservative.healthFactor).gte(constraints.minHealthFactor),
    'CONSTRAINT_VIOLATION',
    'Minimum output does not meet health factor constraint'
  )
  check(
    withinLtv(
      { ...projected, collateralAmount: result.minCollateralAfter },
      snapshot,
      market,
      result.direction !== 'increase'
    ),
    'CONSTRAINT_VIOLATION',
    'Projected debt exceeds collateral LTV'
  )
  if (constraints.maxLeverage && conservative.leverage)
    check(
      n(conservative.leverage).lte(constraints.maxLeverage),
      'CONSTRAINT_VIOLATION',
      'Maximum leverage exceeded'
    )
  const estimate = metrics(projected, market)
  if (['open', 'add_principal', 'remove_principal', 'set_leverage'].includes(action.type))
    check(
      estimate.leverage !== null &&
        n(estimate.leverage).minus(target).abs().lte(target.times('0.0001')),
      'NO_CONVERGENCE',
      'Conversion quote cannot achieve the requested leverage within tolerance'
    )
  return {
    execution: result,
    estimate: { inputs, outputs, minOutputs, ...estimate }
  }
}
