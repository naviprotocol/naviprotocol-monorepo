import type { MultiplyQuote } from './types'
import { BN, check, sameCoin, uint } from './utils'

/** Independently check fixed-flow conservation; the checksum is not authorization. */
export function validateFunding(q: MultiplyQuote) {
  const e = q.execution,
    s = q.strategy,
    a = q.action
  const valid = (value: unknown) =>
    check(value, 'INVALID_QUOTE', 'Execution funding or conversion roles do not match the action')
  const inputType =
    a.type === 'repay'
      ? s.debtCoinType
      : a.type === 'add_collateral'
        ? s.collateralCoinType
        : a.type === 'open' || a.type === 'add_principal'
          ? (a.inputCoinType ?? s.principalCoinType)
          : undefined
  if (inputType) {
    valid('amount' in a && q.estimate.inputs.length === 1 && e.funding.kind !== 'none')
    if (!('amount' in a) || e.funding.kind === 'none') return
    valid(
      q.estimate.inputs[0].amount === a.amount && sameCoin(q.estimate.inputs[0].coinType, inputType)
    )
    valid(e.funding.input.amount === a.amount && sameCoin(e.funding.input.coinType, inputType))
    valid(e.funding.kind === (sameCoin(inputType, s.collateralCoinType) ? 'collateral' : 'debt'))
    if (a.type === 'open' || a.type === 'add_principal')
      valid(
        (s.acceptedInputCoinTypes ?? [s.principalCoinType]).some((type) =>
          sameCoin(type, inputType)
        )
      )
  } else valid(q.estimate.inputs.length === 0 && e.funding.kind === 'none')
  for (const amount of [
    e.flashAmount,
    e.flashRepayment,
    e.borrowAmount,
    e.borrowFee,
    e.withdrawAmount,
    e.collateralAfter,
    e.minCollateralAfter,
    e.debtAfter
  ])
    uint(amount)
  valid(e.conversions.length <= 1) // Current two-asset flows combine same-token funding before conversion.
  const conversion = e.conversions.at(0)
  const C = new BN(e.snapshot.collateralAmount),
    D = new BN(e.snapshot.debtAmount)
  const P = e.funding.kind === 'none' ? new BN(0) : new BN(e.funding.input.amount)
  const eq = (amount: string, value: InstanceType<typeof BN>) => valid(value.eq(amount))
  if (a.type === 'repay' || a.type === 'add_collateral') {
    valid(
      e.direction === a.type &&
        !conversion &&
        e.flashAmount === '0' &&
        e.flashRepayment === '0' &&
        e.borrowAmount === '0' &&
        e.borrowFee === '0' &&
        e.withdrawAmount === '0'
    )
    eq(e.collateralAfter, a.type === 'add_collateral' ? C.plus(P) : C)
    eq(e.debtAfter, a.type === 'repay' ? BN.maximum(0, D.minus(P)) : D)
    valid(e.minCollateralAfter === e.collateralAfter)
  } else if (e.direction === 'increase') {
    valid(
      ['open', 'add_principal', 'set_leverage'].includes(a.type) &&
        e.withdrawAmount === '0' &&
        e.borrowAmount === e.flashRepayment
    )
    const direct = e.funding.kind === 'collateral'
    const amount = new BN(e.flashAmount).plus(direct ? 0 : P)
    valid(!!conversion === amount.gt(0))
    if (conversion) {
      valid(
        conversion.id === 'increase' &&
          conversion.purpose === (e.flashAmount !== '0' ? 'leverage' : 'input')
      )
      valid(
        conversion.source ===
          (direct || P.isZero() ? 'flash' : e.flashAmount !== '0' ? 'wallet-and-flash' : 'wallet')
      )
      valid(
        sameCoin(conversion.input.coinType, s.debtCoinType) &&
          sameCoin(conversion.expectedOutput.coinType, s.collateralCoinType)
      )
      eq(conversion.input.amount, amount)
    }
    eq(e.collateralAfter, C.plus(direct ? P : 0).plus(conversion?.expectedOutput.amount ?? 0))
    eq(e.minCollateralAfter, C.plus(direct ? P : 0).plus(conversion?.minOutput.amount ?? 0))
    eq(e.debtAfter, D.plus(e.flashRepayment).plus(e.borrowFee))
  } else {
    valid(
      e.direction === 'decrease' &&
        ['remove_principal', 'set_leverage', 'close'].includes(a.type) &&
        e.borrowAmount === '0' &&
        e.borrowFee === '0'
    )
    valid(e.funding.kind === 'none' && e.minCollateralAfter === e.collateralAfter)
    eq(e.collateralAfter, C.minus(e.withdrawAmount))
    eq(e.debtAfter, BN.maximum(0, D.minus(e.flashAmount)))
    const collateralPrincipal = sameCoin(s.principalCoinType, s.collateralCoinType)
    if (conversion) {
      valid(
        conversion.purpose === 'repayment' &&
          conversion.source === 'withdrawal' &&
          sameCoin(conversion.input.coinType, s.collateralCoinType) &&
          sameCoin(conversion.expectedOutput.coinType, s.debtCoinType)
      )
      valid(
        new BN(conversion.input.amount).lte(e.withdrawAmount) &&
          new BN(conversion.minOutput.amount).gte(e.flashRepayment)
      )
      if (!collateralPrincipal) valid(conversion.input.amount === e.withdrawAmount)
    } else valid(collateralPrincipal && e.flashAmount === '0' && e.flashRepayment === '0')
    if (a.type === 'remove_principal')
      valid(
        collateralPrincipal
          ? new BN(e.withdrawAmount).minus(conversion?.input.amount ?? 0).gte(a.amount)
          : new BN(conversion?.minOutput.amount ?? 0).minus(e.flashRepayment).gte(a.amount)
      )
  }
  eq(
    e.flashRepayment,
    new BN(e.flashAmount)
      .times(new BN(e.market.flash.feeBps).div(10000).plus(1))
      .integerValue(BN.ROUND_CEIL)
  )
  for (const output of [...q.estimate.outputs, ...q.estimate.minOutputs]) {
    uint(output.amount, false)
    valid(
      sameCoin(output.coinType, s.collateralCoinType) || sameCoin(output.coinType, s.debtCoinType)
    )
  }
}
