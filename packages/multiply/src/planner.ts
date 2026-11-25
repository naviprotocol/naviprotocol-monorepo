import { quoteRedemptionSnapshot } from './native-redemption'
import { quoteStakingSnapshot } from './native-staking'
import { validateMarketMode, assertModeExposure } from './emode'
import type {
  Action,
  Constraints,
  ConversionQuote,
  ConversionRateHint,
  ConversionRequest,
  Converter,
  ExecutionPlan,
  MarketSnapshot,
  PositionAmounts,
  Strategy,
  StakingSnapshot
} from './types'
import { BN, ceil, check, decimal, floor, uint, MultiplyError, sameCoin } from './utils'
import { validateConversion } from './converters'
import {
  isDustClose,
  amountCushion,
  atomPrices,
  borrowCapacity,
  leverageLimit,
  supplyCapacity,
  withinLtv,
  withinSameReserveCapacity
} from './amounts'

type N = InstanceType<typeof BN>
const n = (v: string | number) => new BN(v)
const BORROW_NEEDED =
  'Target leverage needs new debt after this withdrawal; use set_leverage separately'
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
    } else if (
      !(result.reason instanceof MultiplyError) ||
      !['CONVERTER_UNAVAILABLE', 'CONVERSION_AMOUNT_TOO_SMALL', 'NO_CONVERSION_ROUTE'].includes(
        result.reason.code
      )
    ) {
      throw result.reason
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
    if (
      !(error instanceof MultiplyError) ||
      !['CONVERTER_UNAVAILABLE', 'CONVERSION_AMOUNT_TOO_SMALL', 'NO_CONVERSION_ROUTE'].includes(
        error.code
      )
    )
      throw error
    const tooSmall =
      error.code === 'CONVERSION_AMOUNT_TOO_SMALL' &&
      results.every(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof MultiplyError &&
          result.reason.code === 'CONVERSION_AMOUNT_TOO_SMALL'
      )
    throw new MultiplyError(
      tooSmall ? 'CONVERSION_AMOUNT_TOO_SMALL' : 'NO_CONVERSION_ROUTE',
      'No eligible executable conversion route'
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
  convert: (req: ConversionRequest) => Promise<ConversionQuote>,
  readRate?: () => Promise<ConversionRateHint | undefined>,
  readSnapshot?: () => Promise<StakingSnapshot | undefined>,
  readRedemption?: () => Promise<import('./types').RedemptionSnapshot | undefined>,
  sharedBudget?: { deadline: number; count: number },
  readExitRate?: () => Promise<ConversionRateHint | undefined>,
  useSeed = true
) {
  validateMarketMode(strategy, market)
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
  // Repayment and a collateral top-up only reduce risk, so both stay available without positive equity.
  check(
    (C.isZero() && D.isZero()) ||
      equity.gt(0) ||
      ((action.type === 'repay' || action.type === 'add_collateral') && D.gt(0)),
    'POSITION_UNSUPPORTED',
    'Position has non-positive equity'
  )
  const current = metrics(snapshot, market)
  const specified = 'targetLeverage' in action ? action.targetLeverage : undefined
  // "Keep the current leverage" uses the exact ratio: the 12-digit display value would leave a
  // debt-side residual on a large position that a small add_principal cannot absorb.
  const target =
    specified === undefined && current.leverage !== null
      ? C.times(pc).div(equity)
      : decimal(specified ?? '1', '1')
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
  const increasing =
    action.type === 'open' ||
    action.type === 'add_principal' ||
    (action.type === 'set_leverage' && target.gt(current.leverage ?? '1'))
  // Target accuracy is distinct from the risk ceiling in amounts.ts. Only open
  // and upward set_leverage allow 0.1%; additions and exits retain 0.01%.
  const targetTolerance =
    action.type === 'open' || (action.type === 'set_leverage' && increasing) ? '0.001' : '0.0001'
  // An explicit target that adds debt is held to maxLeverage itself; the band only absorbs rounding.
  if (constraints.maxLeverage && increasing && specified !== undefined)
    check(target.lte(constraints.maxLeverage), 'CONSTRAINT_VIOLATION', 'Target exceeds maxLeverage')
  const limit = leverageLimit(
    constraints.maxLeverage,
    action,
    increasing ? 'increase' : 'decrease',
    current.leverage
  )
  if (limit)
    check(
      target.lte(limit),
      'CONSTRAINT_VIOLATION',
      specified === undefined
        ? 'Current leverage exceeds maxLeverage'
        : 'Target exceeds maxLeverage'
    )
  const inputs: { coinType: string; amount: string }[] = [],
    outputs: typeof inputs = [],
    minOutputs: typeof inputs = []
  const result: Omit<ExecutionPlan, 'accountCap' | 'capRegistry' | 'checksum' | 'env'> = {
    version: 4,
    funding: { kind: 'none' },
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
  // TL-01 / TL-02: an add_principal is judged against the principal it adds, not the whole position (a small
  // principal on a large position would otherwise be "reached" unlevered, at F = 0), whether the target is explicit
  // or the current leverage. The residual is the debt-side distance to the target, the same quantity the bracket
  // search drives to zero. The amount is priced in the coin actually supplied (inputCoinType, else the principal),
  // which is the collateral or the debt.
  const principalValue =
    action.type === 'add_principal'
      ? n(action.amount).times(
          sameCoin(action.inputCoinType || strategy.principalCoinType, strategy.collateralCoinType)
            ? pc
            : pd
        )
      : undefined
  const targetReached = (c: N, d: N) => {
    const value = c.times(pc),
      net = value.minus(d.times(pd))
    if (!net.gt(0)) return false
    if (principalValue && principalValue.gt(0)) {
      const residual = d
        .times(pd)
        .minus(value.times(target.minus(1)).div(target))
        .abs()
      return residual.lte(BN.maximum(principalValue.times('0.0001'), pd))
    }
    return value.div(net).minus(target).abs().lte(target.times(targetTolerance))
  }
  // Leave time for the API's other reads within its quote deadline. An abandoned
  // converter promise is read-only; late results are never used in the plan.
  const budget = sharedBudget ?? { deadline: Date.now() + 45_000, count: 0 }
  const budgeted = async <T>(read: () => Promise<T>): Promise<T> => {
    const remaining = budget.deadline - Date.now()
    check(
      ++budget.count <= 32 && remaining > 0,
      'NO_CONVERGENCE',
      'Conversion quote budget exhausted'
    )
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        read(),
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
  const request = (amount: string, increase: boolean) =>
    budgeted(() =>
      convert({
        amountIn: amount,
        coinIn: increase ? strategy.debtCoinType : strategy.collateralCoinType,
        coinOut: increase ? strategy.collateralCoinType : strategy.debtCoinType,
        slippageBps: constraints.maxSlippageBps
      })
    )
  const input = (coinType: string, amount: string) => inputs.push({ coinType, amount })
  if (action.type === 'close' && isDustClose(strategy, snapshot, market)) {
    result.direction = 'decrease'
  } else if (action.type === 'repay' || action.type === 'add_collateral') {
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
  } else if (increasing) {
    const P = n('amount' in action ? action.amount : '0')
    const inputType =
      'inputCoinType' in action && action.inputCoinType
        ? action.inputCoinType
        : strategy.principalCoinType
    const direct = sameCoin(inputType, strategy.collateralCoinType)
    if (P.gt(0)) input(inputType, P.toFixed(0))
    const evaluation = async (F: N, snapshot?: StakingSnapshot) => {
      const conversionAmount = F.plus(direct ? 0 : P)
      const req = {
        amountIn: conversionAmount.toFixed(0),
        coinIn: strategy.debtCoinType,
        coinOut: strategy.collateralCoinType,
        slippageBps: constraints.maxSlippageBps
      }
      const q = conversionAmount.gt(0)
        ? snapshot
          ? quoteStakingSnapshot(snapshot, req)
          : await request(conversionAmount.toFixed(0), true)
        : undefined
      if (q) validateConversion(q, req, snapshot?.converterId ?? q.converterId)
      const repayment = flashRepay(F),
        fee = borrowFee(repayment)
      const c = C.plus(direct ? P : 0).plus(q?.expectedOutput.amount ?? 0),
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
    const increaseResult = (value: Awaited<ReturnType<typeof evaluation>>) => ({
      ...result,
      conversions: value.q
        ? [
            {
              ...value.q,
              id: 'increase',
              purpose: value.F.gt(0) ? ('leverage' as const) : ('input' as const),
              source:
                direct || P.isZero()
                  ? ('flash' as const)
                  : value.F.gt(0)
                    ? ('wallet-and-flash' as const)
                    : ('wallet' as const)
            }
          ]
        : [],
      flashAmount: value.F.toFixed(0),
      flashRepayment: value.repayment.toFixed(0),
      borrowAmount: value.repayment.toFixed(0),
      borrowFee: value.fee.toFixed(0),
      collateralAfter: value.c.toFixed(0),
      minCollateralAfter: C.plus(direct ? P : 0)
        .plus(value.q?.minOutput.amount ?? 0)
        .toFixed(0),
      debtAfter: value.d.toFixed(0)
    })
    // The rate predicts conversion amounts only. Oracle pc/pd remain the valuation
    // basis for the target leverage and every final risk/capacity check.
    let rate = pd.div(pc)
    let usableSeed = useSeed
    let stakingSnapshot: StakingSnapshot | undefined
    if (readSnapshot) {
      try {
        stakingSnapshot = await budgeted(readSnapshot)
        if (stakingSnapshot) {
          // Validate all snapshot fields/fees using a one-unit local probe. No RPC.
          quoteStakingSnapshot(stakingSnapshot, {
            coinIn: strategy.debtCoinType,
            coinOut: strategy.collateralCoinType,
            amountIn: stakingSnapshot.minInput,
            slippageBps: 0
          })
          const sui = uint(stakingSnapshot.suiSupply),
            lst = uint(stakingSnapshot.lstSupply)
          rate = (sui === 0n || lst === 0n ? n(1) : n(lst.toString()).div(sui.toString())).times(
            n(1).minus(n(stakingSnapshot.feeRate).div(stakingSnapshot.feeDenominator))
          )
        }
      } catch (error) {
        if (
          !(error instanceof MultiplyError) ||
          ![
            'SNAPSHOT_UNAVAILABLE',
            'CONVERTER_UNAVAILABLE',
            'CONVERSION_AMOUNT_TOO_SMALL',
            'NO_CONVERSION_ROUTE'
          ].includes(error.code)
        )
          throw error
        usableSeed = false
        stakingSnapshot = undefined
      }
    } else if (readRate && target.gt(1)) {
      try {
        const hint = await budgeted(readRate)
        if (hint) {
          uint(hint.input.amount, false)
          uint(hint.output.amount, false)
          check(
            sameCoin(hint.input.coinType, strategy.debtCoinType) &&
              sameCoin(hint.output.coinType, strategy.collateralCoinType) &&
              Number.isSafeInteger(hint.expiresAt) &&
              hint.expiresAt > Date.now(),
            'INVALID_CONVERSION',
            'Invalid staking rate hint'
          )
          rate = n(hint.output.amount).div(hint.input.amount)
        }
      } catch (error) {
        if (
          !(error instanceof MultiplyError) ||
          !['CONVERTER_UNAVAILABLE', 'CONVERSION_AMOUNT_TOO_SMALL', 'NO_CONVERSION_ROUTE'].includes(
            error.code
          )
        )
          throw error
        usableSeed = false
      }
    }
    const feeFactor = n(1)
      .plus(n(market.flash.feeBps).div(10000))
      .times(n(1).plus(n(borrowFeeBps).div(10000)))
    const denominator = pd
      .times(feeFactor)
      .times(target)
      .minus(pc.times(rate).times(target.minus(1)))
    const seed = n(
      floor(
        C.plus(P.times(direct ? n(1) : rate))
          .times(pc)
          .times(target.minus(1))
          .minus(D.times(pd).times(target))
          .div(denominator)
      )
    )
    let seeded: Awaited<ReturnType<typeof evaluation>> | undefined
    if (
      usableSeed &&
      denominator.gt(0) &&
      seed.isFinite() &&
      seed.gte(0) &&
      seed.lte('18446744073709551615')
    ) {
      try {
        const candidate = await evaluation(seed, stakingSnapshot)
        if (targetReached(candidate.c, candidate.d)) {
          try {
            validateResult(increaseResult(candidate))
            seeded = candidate
          } catch (error) {
            // A rounded seed can pass the principal-relative check but miss the final
            // whole-position tolerance. Only that validation failure is recoverable;
            // converter/deadline NO_CONVERGENCE errors still propagate below.
            if (!(error instanceof MultiplyError) || error.code !== 'NO_CONVERGENCE') throw error
          }
        }
      } catch (error) {
        // An unusable candidate falls straight back to the original bracket search.
        // Invalid data, paused markets and the shared deadline remain hard failures.
        if (
          !(error instanceof MultiplyError) ||
          ![
            'SNAPSHOT_UNAVAILABLE',
            'CONVERTER_UNAVAILABLE',
            'CONVERSION_AMOUNT_TOO_SMALL',
            'NO_CONVERSION_ROUTE',
            'CAPACITY_EXCEEDED',
            'CONSTRAINT_VIOLATION'
          ].includes(error.code)
        )
          throw error
      }
    }
    const initialHi = n(
      ceil(
        equity
          .plus(P.times(direct ? pc : pd))
          .times(target.minus(1))
          .div(pd)
          .times(2)
          .plus(1)
      )
    )
    let lo = n(0),
      hi = initialHi
    let best: Awaited<ReturnType<typeof evaluation>> | undefined = seeded
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
    let converged = seeded !== undefined || (await bracket())
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
    Object.assign(result, increaseResult(best))
  } else if (sameCoin(strategy.principalCoinType, strategy.collateralCoinType)) {
    result.direction = 'decrease'
    check(C.gt(0), 'POSITION_NOT_FOUND', 'No collateral to withdraw')
    const close = action.type === 'close'
    const payout = n(action.type === 'remove_principal' ? action.amount : 0)
    check(
      close || payout.times(pc).lt(equity),
      'CONSTRAINT_VIOLATION',
      'Withdrawal consumes all equity; use close'
    )
    const fullRepay = D.isZero() ? D : n(ceil(D.times('1.0001').plus(amountCushion(market.debt))))
    const evaluate = async (W: N) => {
      const q = W.gt(0) ? await request(W.toFixed(0), false) : undefined
      const available = n(q?.minOutput.amount ?? 0)
      const R =
        close || target.eq(1)
          ? fullRepay
          : BN.minimum(D, n(floor(available.div(n(market.flash.feeBps).div(10000).plus(1)))))
      const total = close ? C : W.plus(payout)
      const c = C.minus(total),
        d = BN.maximum(0, D.minus(R))
      return {
        q,
        W,
        R,
        total,
        c,
        d,
        repayment: flashRepay(R),
        available,
        residual: d.times(pd).minus(c.times(pc).times(target.minus(1)).div(target))
      }
    }
    const clearingDebt = close || target.eq(1)
    const maxConversion = C.minus(payout)
    let W = D.isZero()
      ? n(0)
      : close || target.eq(1)
        ? n(ceil(flashRepay(fullRepay).times(pd).div(pc).times('1.01')))
        : n(
            ceil(
              D.times(pd)
                .minus(C.minus(payout).times(pc).times(target.minus(1)).div(target))
                .times(target)
                .div(pc)
            )
          )
    // A negative estimate means the withdrawal alone leaves the position below the target:
    // reaching it needs new debt, which a decrease cannot add.
    check(clearingDebt || W.gte(0), 'ACTION_UNSUPPORTED', BORROW_NEEDED)
    // The oracle cushion is only a search estimate, not proof of insufficient
    // collateral. Test the executable minimum at the available balance first.
    if (clearingDebt) W = BN.minimum(W, maxConversion)
    let best: Awaited<ReturnType<typeof evaluate>> | undefined
    for (let i = 0; i < 20; i++) {
      check(
        W.gte(0) && W.plus(close ? 0 : payout).lte(C),
        'CONSTRAINT_VIOLATION',
        'Insufficient collateral to repay debt and withdraw principal'
      )
      best = await evaluate(W)
      const shortfall = best.repayment.minus(best.available)
      check(
        !clearingDebt || W.lt(maxConversion) || shortfall.lte(0),
        'CONSTRAINT_VIOLATION',
        'Insufficient collateral to repay debt and withdraw principal'
      )
      // Trim the initial price cushion; keep only the collateral needed for debt repayment.
      if ((close || target.eq(1)) && shortfall.lt(0) && W.gt(0) && i < 2) {
        const trimmed = n(ceil(W.times(best.repayment).div(best.available)))
        if (trimmed.gt(0) && trimmed.lt(W)) {
          W = trimmed
          continue
        }
      }
      if (shortfall.lte(0) && (close || targetReached(best.c, best.d))) break
      const delta =
        close || target.eq(1) ? shortfall.times(pd).div(pc) : best.residual.times(target).div(pc)
      let next = BN.maximum(1, n(ceil(W.plus(delta.times('1.01')).plus(shortfall.gt(0) ? 1 : 0))))
      if (clearingDebt) next = BN.minimum(next, maxConversion)
      check(i < 19 && !next.eq(W), 'NO_CONVERGENCE', 'No feasible collateral-principal decrease')
      W = next
    }
    check(
      best && best.repayment.lte(best.available),
      'NO_CONVERGENCE',
      'Missing collateral-principal decrease plan'
    )
    result.conversions = best.q
      ? [{ ...best.q, id: 'repayment', purpose: 'repayment', source: 'withdrawal' }]
      : []
    result.flashAmount = best.R.toFixed(0)
    result.flashRepayment = best.repayment.toFixed(0)
    result.withdrawAmount = best.total.toFixed(0)
    result.collateralAfter = result.minCollateralAfter = best.c.toFixed(0)
    result.debtAfter = best.d.toFixed(0)
    const principalOut = best.total.minus(best.W)
    if (principalOut.gt(0)) {
      outputs.push({ coinType: strategy.principalCoinType, amount: principalOut.toFixed(0) })
      minOutputs.push({ coinType: strategy.principalCoinType, amount: principalOut.toFixed(0) })
    }
    const debtOut = n(best.q?.expectedOutput.amount ?? 0)
      .minus(best.repayment)
      .plus(BN.maximum(0, best.R.minus(D)))
    if (debtOut.gt(0)) outputs.push({ coinType: strategy.debtCoinType, amount: floor(debtOut) })
  } else {
    result.direction = 'decrease'
    if (
      action.type === 'close' &&
      C.isZero() &&
      snapshot.protocolCollateralAmount &&
      snapshot.protocolCollateralAmount !== '0'
    )
      throw new MultiplyError(
        'POSITION_UNSUPPORTED',
        'This pool does not support collateral dust cleanup'
      )
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
    const evaluation = async (W: N, native?: import('./types').RedemptionSnapshot) => {
      const req = {
        coinIn: strategy.collateralCoinType,
        coinOut: strategy.debtCoinType,
        amountIn: W.toFixed(0),
        slippageBps: constraints.maxSlippageBps
      }
      const q = native ? quoteRedemptionSnapshot(native, req) : await request(W.toFixed(0), false)
      if (native) validateConversion(q, req, native.converterId)
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
    let best: Awaited<ReturnType<typeof evaluation>> | undefined
    const decreaseResult = (v: Awaited<ReturnType<typeof evaluation>>) => ({
      ...result,
      conversions: [
        { ...v.q, id: 'withdrawal', purpose: 'repayment' as const, source: 'withdrawal' as const }
      ],
      flashAmount: v.R.toFixed(0),
      flashRepayment: v.repayment.toFixed(0),
      withdrawAmount: v.W.toFixed(0),
      collateralAfter: v.c.toFixed(0),
      minCollateralAfter: v.c.toFixed(0),
      debtAfter: v.d.toFixed(0)
    })
    let firstExitCandidate: Awaited<ReturnType<typeof evaluation>> | undefined
    // A gross chain rate is only an initial guess. Every candidate uses an actual
    // Astros output/minimum; native cash, fees and minimums are not admission gates.
    if (!close && readExitRate && useSeed) {
      try {
        const hint = await budgeted(readExitRate)
        if (hint) {
          uint(hint.input.amount, false)
          uint(hint.output.amount, false)
          check(
            sameCoin(hint.input.coinType, strategy.collateralCoinType) &&
              sameCoin(hint.output.coinType, strategy.debtCoinType) &&
              Number.isSafeInteger(hint.expiresAt) &&
              hint.expiresAt > Date.now(),
            'INVALID_CONVERSION',
            'Invalid redemption rate hint'
          )
          const rate = n(hint.output.amount)
            .div(hint.input.amount)
            .times(n(1).minus(n(constraints.maxSlippageBps).div(10000)))
          const a = target.minus(1).div(target),
            b = n(1).plus(n(market.flash.feeBps).div(10000))
          const denominator = rate.minus(b.times(a).times(pc).div(pd))
          const W = target.eq(1)
            ? n(ceil(flashRepay(fullRepay).plus(payout).div(rate)))
            : n(
                ceil(
                  b
                    .times(D.minus(a.times(C).times(pc).div(pd)))
                    .plus(payout)
                    .div(denominator)
                )
              )
          if ((target.eq(1) || denominator.gt(0)) && W.isFinite() && W.gt(0) && W.lte(C)) {
            const candidate = await evaluation(W)
            firstExitCandidate = candidate
            if (
              candidate.R.gte(0) &&
              candidate.repayment.plus(payout).lte(candidate.q.minOutput.amount) &&
              targetReached(candidate.c, candidate.d)
            ) {
              try {
                validateResult(decreaseResult(candidate))
                best = candidate
              } catch (error) {
                if (
                  !(error instanceof MultiplyError) ||
                  !['NO_CONVERGENCE', 'CAPACITY_EXCEEDED', 'CONSTRAINT_VIOLATION'].includes(
                    error.code
                  )
                )
                  throw error
              }
            }
          }
        }
      } catch (error) {
        if (
          !(error instanceof MultiplyError) ||
          ![
            'SNAPSHOT_UNAVAILABLE',
            'CONVERTER_UNAVAILABLE',
            'CONVERSION_AMOUNT_TOO_SMALL',
            'NO_CONVERSION_ROUTE'
          ].includes(error.code)
        )
          throw error
      }
    }
    if (readRedemption) {
      try {
        const native = await budgeted(readRedemption)
        if (native) {
          const rate = n(native.suiSupply)
            .div(native.lstSupply)
            .times(n(1).minus(n(native.feeRate).div(native.feeDenominator)))
            .times(n(1).minus(n(constraints.maxSlippageBps).div(10000)))
          const a = target.minus(1).div(target),
            b = n(1).plus(n(market.flash.feeBps).div(10000))
          const denominator = rate.minus(b.times(a).times(pc).div(pd))
          const W = close
            ? C
            : target.eq(1)
              ? n(ceil(flashRepay(fullRepay).plus(payout).div(rate)))
              : n(
                  ceil(
                    b
                      .times(D.minus(a.times(C).times(pc).div(pd)))
                      .plus(payout)
                      .div(denominator)
                  )
                )
          if ((close || target.eq(1) || denominator.gt(0)) && W.isFinite() && W.gt(0) && W.lte(C)) {
            // Correct only integer rounding locally. No RPC loop and no relaxed tolerance.
            for (const offset of close ? [0] : [0, 1, -1, 2, -2, 3, -3, 4]) {
              const candidateW = W.plus(offset)
              if (!candidateW.gt(0) || candidateW.gt(C)) continue
              const candidate = await evaluation(candidateW, native)
              if (
                candidate.R.lt(0) ||
                candidate.repayment.plus(payout).gt(candidate.q.minOutput.amount) ||
                (!close && !targetReached(candidate.c, candidate.d))
              )
                continue
              try {
                validateResult(decreaseResult(candidate))
                best = candidate
                break
              } catch (error) {
                if (
                  !(error instanceof MultiplyError) ||
                  !['NO_CONVERGENCE', 'CAPACITY_EXCEEDED', 'CONSTRAINT_VIOLATION'].includes(
                    error.code
                  )
                )
                  throw error
              }
            }
          }
        }
      } catch (error) {
        if (
          !(error instanceof MultiplyError) ||
          ![
            'SNAPSHOT_UNAVAILABLE',
            'CONVERTER_UNAVAILABLE',
            'CONVERSION_AMOUNT_TOO_SMALL',
            'NO_CONVERSION_ROUTE'
          ].includes(error.code)
        )
          throw error
      }
    }
    if (!best) {
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
        // Even with the payout left as debt the position stays below the target: it needs new debt.
        check(target.eq(1) || W.gte(0), 'ACTION_UNSUPPORTED', BORROW_NEEDED)
        // The same holds when the payout is funded by collateral at oracle value and nothing is repaid.
        // Conversions can price differently, so this only names the cause once the search has failed.
        const borrowNeeded =
          !target.eq(1) &&
          D.times(pd).lt(C.times(pc).minus(payout.times(pd)).times(target.minus(1)).div(target))
        if (target.eq(1)) W = n(ceil(fullRepay.plus(payout).times(pd).div(pc).times('1.01')))
        W = BN.maximum(1, BN.minimum(C, W))
        // Continue the unchanged correction loop from the real first quote, once.
        // Do not reset to an oracle guess or permanently memoize market responses.
        if (firstExitCandidate && firstExitCandidate.q.expiresAt > Date.now())
          W = firstExitCandidate.W
        for (let i = 0; i < 20; i++) {
          best =
            i === 0 &&
            firstExitCandidate &&
            firstExitCandidate.W.eq(W) &&
            firstExitCandidate.q.expiresAt > Date.now()
              ? firstExitCandidate
              : await evaluation(W)
          const shortfall = best.repayment.plus(payout).minus(best.q.minOutput.amount)
          // Trim the initial price cushion; convert only what repayment and the payout need.
          if (target.eq(1) && shortfall.lt(0) && i < 2) {
            const trimmed = n(
              ceil(W.times(best.repayment.plus(payout)).div(best.q.minOutput.amount))
            )
            if (trimmed.gt(0) && trimmed.lt(W)) {
              W = trimmed
              continue
            }
          }

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
          if (!(next.lt(C) && !next.eq(W) && i < 19))
            throw borrowNeeded
              ? new MultiplyError('ACTION_UNSUPPORTED', BORROW_NEEDED)
              : new MultiplyError(
                  'NO_CONVERGENCE',
                  'No feasible deleverage route within constraints'
                )
          W = next
        }
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
    result.conversions = [
      { ...best.q, id: 'withdrawal', purpose: 'repayment', source: 'withdrawal' }
    ]
    result.flashAmount = best.R.toFixed(0)
    result.flashRepayment = best.repayment.toFixed(0)
    result.withdrawAmount = best.W.toFixed(0)
    result.collateralAfter = result.minCollateralAfter = best.c.toFixed(0)
    result.debtAfter = best.d.toFixed(0)
    if (output.gt(0)) outputs.push({ coinType: strategy.principalCoinType, amount: floor(output) })
    if (minOutput.gt(0))
      minOutputs.push({ coinType: strategy.principalCoinType, amount: floor(minOutput) })
  }
  if (inputs.length)
    result.funding = {
      kind: sameCoin(inputs[0].coinType, strategy.collateralCoinType) ? 'collateral' : 'debt',
      input: inputs[0]
    }
  // One validator for both the optional price seed and the final solver result.
  // Keep the acceptance criteria identical regardless of how the amount was found.
  function validateResult(candidate: typeof result) {
    for (const amount of [
      candidate.flashAmount,
      candidate.flashRepayment,
      candidate.borrowAmount,
      candidate.borrowFee,
      candidate.withdrawAmount,
      candidate.collateralAfter,
      candidate.debtAfter
    ])
      uint(amount)
    const f = n(candidate.flashAmount)
    check(
      f.isZero() || (f.gte(market.flash.min) && f.lte(market.flash.max)),
      'CAPACITY_EXCEEDED',
      'Flash liquidity limit exceeded'
    )
    check(
      n(candidate.borrowAmount).plus(candidate.borrowFee).lte(borrowCapacity(market)),
      'CAPACITY_EXCEEDED',
      'Borrow liquidity limit exceeded'
    )
    check(
      withinSameReserveCapacity(strategy, candidate, market),
      'CAPACITY_EXCEEDED',
      'Flash and borrow from the same reserve exceed its cash'
    )
    check(
      n(candidate.collateralAfter).minus(C).lte(supplyCapacity(market)),
      'CAPACITY_EXCEEDED',
      'Supply capacity exceeded'
    )
    assertModeExposure(action, candidate, market)
    const projected = {
      collateralAmount: candidate.collateralAfter,
      debtAmount: candidate.debtAfter
    }
    const conservative = metrics(
      { ...projected, collateralAmount: candidate.minCollateralAfter },
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
        { ...projected, collateralAmount: candidate.minCollateralAfter },
        snapshot,
        market,
        candidate.direction !== 'increase'
      ),
      'CONSTRAINT_VIOLATION',
      'Projected debt exceeds collateral LTV'
    )
    const resultLimit = leverageLimit(
      constraints.maxLeverage,
      action,
      candidate.direction,
      current.leverage
    )
    if (resultLimit && conservative.leverage)
      check(
        n(conservative.leverage).lte(resultLimit),
        'CONSTRAINT_VIOLATION',
        'Leverage at the minimum conversion output exceeds maxLeverage'
      )
    const estimate = metrics(projected, market)
    if (['open', 'add_principal', 'remove_principal', 'set_leverage'].includes(action.type))
      check(
        estimate.leverage !== null &&
          n(estimate.leverage).minus(target).abs().lte(target.times(targetTolerance)),
        'NO_CONVERGENCE',
        'Conversion quote cannot achieve the requested leverage within tolerance'
      )
    return estimate
  }
  const estimate = validateResult(result)

  return {
    execution: result,
    estimate: { inputs, outputs, minOutputs, ...estimate }
  }
}
