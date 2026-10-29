import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import type {
  AccountCap,
  Action,
  BuildInputs,
  BuildResult,
  Constraints,
  Converter,
  DataSource,
  MultiplyOptions,
  MultiplyQuote,
  Position,
  Strategy
} from './types'
import { astrosConverter, haedalConverter, voloConverter, validateConversion } from './converters'
import { createNaviDataSource, defaultClient } from './data-source'
import { capName, strategies as builtInStrategies } from './strategies'
import { chooseConversion, metrics, plan, validateAction } from './planner'
import {
  BN,
  address,
  check,
  checksum,
  coinType,
  jsonCopy,
  minOutputGuard,
  sameCoin,
  uint
} from './utils'

export function createMultiplyClient(options: MultiplyOptions = {}) {
  const client = options.client ?? defaultClient()
  const source: DataSource =
    options.dataSource ?? createNaviDataSource({ client, services: options.services })
  const converters = options.converters ?? [voloConverter({ client }), haedalConverter({ client })]
  const fallback = options.fallbackConverter ?? astrosConverter({ services: options.services })
  const registry = new Map<string, Converter>()
  for (const c of [...converters, fallback]) {
    check(!registry.has(c.id), 'INVALID_ARGUMENT', `Duplicate converter id: ${c.id}`)
    registry.set(c.id, c)
  }
  const strategyRegistry = options.strategies ?? Object.values(builtInStrategies)
  function validateStrategy(input: Strategy): Strategy {
    check(
      typeof input?.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.id),
      'INVALID_ARGUMENT',
      'Strategy id must be a stable ASCII slug'
    )
    check(
      typeof input.market === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.market),
      'INVALID_ARGUMENT',
      'Missing market'
    )
    check(
      input.emodeId === undefined,
      'STRATEGY_UNSUPPORTED',
      'E-Mode risk overrides are not supported in this release'
    )
    const s = {
      ...input,
      principalCoinType: coinType(input.principalCoinType),
      collateralCoinType: coinType(input.collateralCoinType),
      debtCoinType: coinType(input.debtCoinType)
    }
    check(
      sameCoin(s.principalCoinType, s.debtCoinType) &&
        !sameCoin(s.collateralCoinType, s.debtCoinType),
      'STRATEGY_UNSUPPORTED',
      'Requires principal = debt and a distinct collateral token'
    )
    return s
  }
  async function findCap(owner: string, strategy: Strategy) {
    const caps = (await source.listAccountCaps(owner)).filter((c) => c.strategyId === strategy.id)
    check(
      caps.length <= 1,
      'DUPLICATE_ACCOUNT_CAP',
      'More than one Multiply Cap exists for this wallet and strategy'
    )
    const cap = caps[0]
    if (cap) {
      address(cap.id)
      address(cap.accountOwner)
      check(
        cap.name === capName(strategy.id),
        'INVALID_ACCOUNT_CAP',
        'Cap name does not match strategy'
      )
      if (cap.strategy)
        check(
          (await checksum(validateStrategy(cap.strategy))) === (await checksum(strategy)),
          'INVALID_ACCOUNT_CAP',
          'Stored strategy definition differs from the requested market or tokens'
        )
    }
    return cap
  }
  async function getPosition(
    owner: string,
    query: { strategy?: Strategy } = {}
  ): Promise<Position[]> {
    owner = address(owner)
    const result: Position[] = []
    for (const strategy of (query.strategy ? [query.strategy] : strategyRegistry).map(
      validateStrategy
    )) {
      const cap = await findCap(owner, strategy)
      if (!cap) continue
      const market = await source.readMarket(strategy),
        amounts = await source.readPosition(cap, strategy, market)
      uint(amounts.collateralAmount)
      uint(amounts.debtAmount)
      result.push({
        address: owner,
        strategy,
        accountCap: cap,
        ...amounts,
        ...metrics(amounts, market)
      })
    }
    return result
  }
  async function quote(
    owner: string,
    suppliedStrategy: Strategy,
    action: Action,
    constraints: Constraints
  ): Promise<MultiplyQuote> {
    owner = address(owner)
    validateAction(action, constraints)
    const strategy = validateStrategy(suppliedStrategy)
    const cap = await findCap(owner, strategy)
    check(
      cap || action.type === 'open',
      'POSITION_NOT_FOUND',
      'Only open may create a Multiply Cap'
    )
    const market = await source.readMarket(strategy)
    const snapshot = cap
      ? await source.readPosition(cap, strategy, market)
      : { collateralAmount: '0', debtAmount: '0' }
    uint(snapshot.collateralAmount)
    uint(snapshot.debtAmount)
    const empty = snapshot.collateralAmount === '0' && snapshot.debtAmount === '0'
    check(
      action.type !== 'open' || empty,
      'POSITION_EXISTS',
      'Use add_principal or set_leverage for an existing position'
    )
    check(
      action.type === 'open' || !empty,
      'POSITION_NOT_FOUND',
      'Empty position; use open to reuse this Cap'
    )
    if ('targetLeverage' in action && action.targetLeverage) {
      const maxRatio = BN.minimum(
        new BN(market.ltv).div(market.borrowWeight),
        new BN(market.liquidationThreshold).div(
          new BN(market.borrowWeight).times(constraints.minHealthFactor)
        )
      )
      const ratio = new BN(1).minus(new BN(1).div(action.targetLeverage))
      check(
        ratio.lte(maxRatio),
        'CONSTRAINT_VIOLATION',
        'Target leverage exceeds protocol or health factor limits'
      )
    }
    const fee = await source.readBorrowFeeBps(market, cap?.accountOwner)
    const planned = await plan(strategy, action, constraints, snapshot, market, fee, (req) =>
      chooseConversion(req, converters, fallback)
    )
    const q: MultiplyQuote = {
      address: owner,
      strategy,
      action: jsonCopy(action),
      constraints: jsonCopy(constraints),
      expiresAt: Math.min(
        Date.now() + 120_000,
        ...planned.execution.conversions.map((c) => c.expiresAt)
      ),
      estimate: planned.estimate,
      execution: {
        ...planned.execution,
        accountCap: cap
          ? { kind: 'existing', ...cap }
          : { kind: 'create', name: capName(strategy.id) },
        checksum: ''
      }
    }
    q.execution.checksum = await checksum(q)
    return jsonCopy(q)
  }
  async function buildPTB(
    tx: Transaction,
    suppliedQuote: MultiplyQuote,
    inputs: BuildInputs
  ): Promise<BuildResult> {
    const q = jsonCopy(suppliedQuote)
    check(q.execution?.version === 1, 'INVALID_QUOTE', 'Unknown quote version')
    const expectedHash = q.execution.checksum
    q.execution.checksum = ''
    check(
      expectedHash === (await checksum(q)),
      'INVALID_QUOTE',
      'Quote contents have changed; request a fresh quote'
    )
    q.execution.checksum = expectedHash
    check(
      Number.isSafeInteger(q.expiresAt) && q.expiresAt > Date.now(),
      'QUOTE_EXPIRED',
      'Multiply quote expired'
    )
    address(q.address)
    validateStrategy(q.strategy)
    validateAction(q.action, q.constraints)
    const e = q.execution,
      s = q.strategy
    const coins = inputs.coins ?? []
    check(
      coins.length === q.estimate.inputs.length,
      'INVALID_INPUTS',
      'Provide exactly the quoted input coins'
    )
    for (const expected of q.estimate.inputs)
      check(
        coins.filter((c) => sameCoin(c.coinType, expected.coinType)).length === 1,
        'INVALID_INPUTS',
        `Missing or duplicate input: ${expected.coinType}`
      )
    for (const conversion of e.conversions) {
      check(
        registry.has(conversion.converterId),
        'INVALID_CONVERSION',
        'Quoted converter is not configured'
      )
      validateConversion(
        conversion,
        {
          coinIn: conversion.input.coinType,
          coinOut: conversion.expectedOutput.coinType,
          amountIn: conversion.input.amount,
          slippageBps: q.constraints.maxSlippageBps
        },
        conversion.converterId
      )
    }
    const cap = await findCap(q.address, s)
    if (e.accountCap.kind === 'create')
      check(
        !cap && !inputs.accountCap,
        'STALE_QUOTE',
        'Cap was created since quote or an unexpected Cap was supplied'
      )
    else {
      check(
        cap && cap.id === e.accountCap.id && cap.accountOwner === e.accountCap.accountOwner,
        'STALE_QUOTE',
        'AccountCap changed since quote'
      )
      if (typeof inputs.accountCap === 'string')
        check(address(inputs.accountCap) === address(cap.id), 'INVALID_INPUTS', 'Wrong AccountCap')
    }
    const fresh = await source.readMarket(s)
    for (const key of [
      'package',
      'storage',
      'priceOracle',
      'incentiveV2',
      'incentiveV3',
      'limter'
    ] as const)
      check(fresh.config[key] === e.market.config[key], 'STALE_QUOTE', `Market ${key} changed`)
    check(
      fresh.collateral.contract.pool === e.market.collateral.contract.pool &&
        fresh.debt.contract.pool === e.market.debt.contract.pool &&
        fresh.flash.poolId === e.market.flash.poolId,
      'STALE_QUOTE',
      'Pool configuration changed'
    )
    const now = cap
      ? await source.readPosition(cap, s, fresh)
      : { collateralAmount: '0', debtAmount: '0' }
    // Interest may accrue; position mutations need a new quote. On-chain checks remain authoritative.
    const collateralDelta = new BN(now.collateralAmount).minus(e.snapshot.collateralAmount)
    const debtDelta = new BN(now.debtAmount).minus(e.snapshot.debtAmount)
    check(
      collateralDelta.gte(0) &&
        collateralDelta.lte(new BN(e.snapshot.collateralAmount).times('0.0001').plus(1000)) &&
        debtDelta.gte(0) &&
        debtDelta.lte(new BN(e.snapshot.debtAmount).times('0.0001').plus(1000)),
      'STALE_QUOTE',
      'Position changed since quote'
    )
    const currentFee = await source.readBorrowFeeBps(fresh, cap?.accountOwner)
    check(
      new BN(e.borrowAmount).times(currentFee).div(10000).integerValue().lte(e.borrowFee),
      'STALE_QUOTE',
      'Borrow fee increased'
    )
    check(fresh.flash.feeBps === e.market.flash.feeBps, 'STALE_QUOTE', 'Flash fee changed')
    const projected = {
      collateralAmount: new BN(e.minCollateralAfter).plus(collateralDelta).toFixed(0),
      debtAmount: new BN(e.debtAfter).plus(q.action.type === 'close' ? 0 : debtDelta).toFixed(0)
    }
    const risk = metrics(projected, fresh)
    check(
      risk.healthFactor === null || new BN(risk.healthFactor).gte(q.constraints.minHealthFactor),
      'STALE_QUOTE',
      'Updated market no longer satisfies HF'
    )
    check(
      Number.isSafeInteger(fresh.observedAt) && Date.now() - fresh.observedAt <= 120_000,
      'STALE_QUOTE',
      'Current market snapshot is stale'
    )
    if (q.constraints.maxLeverage && risk.leverage)
      check(
        new BN(risk.leverage).lte(q.constraints.maxLeverage),
        'STALE_QUOTE',
        'Updated market exceeds maximum leverage'
      )
    check(
      new BN(projected.debtAmount)
        .times(fresh.debtPrice)
        .times(fresh.borrowWeight)
        .lte(new BN(projected.collateralAmount).times(fresh.collateralPrice).times(fresh.ltv)),
      'STALE_QUOTE',
      'Updated market exceeds LTV'
    )
    check(
      new BN(e.flashAmount).lte(fresh.flash.max) &&
        (e.flashAmount === '0' || new BN(e.flashAmount).gte(fresh.flash.min)),
      'CAPACITY_EXCEEDED',
      'Flash capacity changed'
    )
    check(
      new BN(e.collateralAfter)
        .minus(e.snapshot.collateralAmount)
        .lte(new BN(fresh.collateral.leftSupply).shiftedBy(9)),
      'CAPACITY_EXCEEDED',
      'Supply capacity changed'
    )
    check(
      new BN(e.borrowAmount).plus(e.borrowFee).lte(fresh.debt.availableBorrow),
      'CAPACITY_EXCEEDED',
      'Borrow liquidity changed'
    )
    // All preflight checks precede mutation. A later network/build failure requires discarding the PTB.
    await source.prepareOracle(tx, s, fresh)
    const config = fresh.config
    const createdAccountCap =
      e.accountCap.kind === 'create'
        ? tx.moveCall({ target: `${config.package}::lending::create_account` })
        : undefined
    const accountCap =
      createdAccountCap ?? inputs.accountCap ?? tx.object((e.accountCap as AccountCap).id)
    if (createdAccountCap) {
      tx.moveCall({
        target: `${config.package}::account::set_account_name`,
        arguments: [createdAccountCap, tx.pure.string(capName(s.id))]
      })
      tx.moveCall({
        target: `${config.package}::account::set_account_description`,
        arguments: [createdAccountCap, tx.pure.string(JSON.stringify(s))]
      })
    }
    const change: BuildResult['coins'] = []
    const exact = (type: string, amount: string) => {
      const supplied = coins.find((c) => sameCoin(c.coinType, type))!
      const coin = tx.splitCoins(supplied.coin, [amount])[0]
      change.push(supplied)
      return coin
    }
    const asCoin = (balance: TransactionObjectArgument, type: string) =>
      tx.moveCall({
        target: '0x2::coin::from_balance',
        typeArguments: [type],
        arguments: [balance]
      })
    const asBalance = (coin: TransactionObjectArgument, type: string) =>
      tx.moveCall({ target: '0x2::coin::into_balance', typeArguments: [type], arguments: [coin] })
    const deposit = (coin: TransactionObjectArgument) =>
      tx.moveCall({
        target: `${config.package}::incentive_v3::deposit_with_account_cap`,
        typeArguments: [s.collateralCoinType],
        arguments: [
          tx.object('0x6'),
          tx.object(config.storage),
          tx.object(fresh.collateral.contract.pool),
          tx.pure.u8(fresh.collateral.id),
          coin,
          tx.object(config.incentiveV2),
          tx.object(config.incentiveV3),
          accountCap
        ]
      })
    const repay = (coin: TransactionObjectArgument) =>
      asCoin(
        tx.moveCall({
          target: `${config.package}::incentive_v3::repay_with_account_cap`,
          typeArguments: [s.debtCoinType],
          arguments: [
            tx.object('0x6'),
            tx.object(config.priceOracle),
            tx.object(config.storage),
            tx.object(fresh.debt.contract.pool),
            tx.pure.u8(fresh.debt.id),
            coin,
            tx.object(config.incentiveV2),
            tx.object(config.incentiveV3),
            accountCap
          ]
        }),
        s.debtCoinType
      )
    let flashCoin: TransactionObjectArgument | undefined,
      receipt: TransactionObjectArgument | undefined
    if (e.flashAmount !== '0') {
      const borrowed = tx.moveCall({
        target: `${fresh.flash.config.package}::lending::flash_loan_with_ctx_v2`,
        typeArguments: [s.debtCoinType],
        arguments: [
          tx.object(fresh.flash.config.flashloanConfig),
          tx.object(fresh.flash.poolId),
          tx.pure.u64(e.flashAmount),
          tx.object('0x5')
        ]
      })
      flashCoin = asCoin(borrowed[0], s.debtCoinType)
      receipt = borrowed[1]
    }
    const repayFlash = (coin: TransactionObjectArgument) =>
      receipt
        ? asCoin(
            tx.moveCall({
              target: `${fresh.flash.config.package}::lending::flash_repay_with_ctx`,
              typeArguments: [s.debtCoinType],
              arguments: [
                tx.object('0x6'),
                tx.object(fresh.flash.config.storage),
                tx.object(fresh.flash.poolId),
                receipt,
                asBalance(coin, s.debtCoinType)
              ]
            }),
            s.debtCoinType
          )
        : coin
    const convert = async (coin: TransactionObjectArgument) => {
      const conversion = e.conversions[0]
      const built = await registry.get(conversion.converterId)!.buildPTB(tx, conversion, coin)
      // Injected converters must honor the same bound; enforce it independently as well.
      minOutputGuard(tx, built.coinOut, conversion.minOutput.amount)
      change.push(...built.change)
      return built.coinOut
    }
    if (e.direction === 'repay')
      change.push({
        coinType: s.debtCoinType,
        coin: repay(exact(s.debtCoinType, q.estimate.inputs[0].amount))
      })
    else if (e.direction === 'add_collateral')
      deposit(exact(s.collateralCoinType, q.estimate.inputs[0].amount))
    else if (e.direction === 'increase') {
      let funds = flashCoin
      if (q.estimate.inputs.length) {
        const contribution = exact(s.principalCoinType, q.estimate.inputs[0].amount)
        if (funds) tx.mergeCoins(funds, [contribution])
        else funds = contribution
      }
      check(funds, 'INVALID_QUOTE', 'Increase plan has no funds')
      deposit(await convert(funds))
      if (receipt) {
        const balance = tx.moveCall({
          target: `${config.package}::incentive_v3::borrow_with_account_cap_v2`,
          typeArguments: [s.debtCoinType],
          arguments: [
            tx.object('0x6'),
            tx.object(config.priceOracle),
            tx.object(config.storage),
            tx.object(fresh.debt.contract.pool),
            tx.pure.u8(fresh.debt.id),
            tx.pure.u64(e.borrowAmount),
            tx.object(config.incentiveV2),
            tx.object(config.incentiveV3),
            accountCap,
            tx.object('0x5')
          ]
        })
        change.push({ coinType: s.debtCoinType, coin: repayFlash(asCoin(balance, s.debtCoinType)) })
      }
    } else {
      const repayChange = flashCoin ? repay(flashCoin) : undefined
      let withdrawAmount: TransactionObjectArgument | ReturnType<typeof tx.pure.u64> = tx.pure.u64(
        e.withdrawAmount
      )
      if (q.action.type === 'close') {
        const owner = tx.moveCall({
          target: `${config.package}::account::account_owner`,
          arguments: [accountCap]
        })
        tx.moveCall({
          target: `${config.package}::lending::update_state_of_user`,
          arguments: [tx.object('0x6'), tx.object(config.storage), owner]
        })
        const balance = tx.moveCall({
          target: `${config.package}::logic::user_collateral_balance`,
          arguments: [tx.object(config.storage), tx.pure.u8(fresh.collateral.id), owner]
        })
        const optional = tx.moveCall({ target: '0x1::u256::try_as_u64', arguments: [balance] })
        withdrawAmount = tx.moveCall({
          target: '0x1::option::destroy_some',
          typeArguments: ['u64'],
          arguments: [optional]
        })
      }
      const collateral = asCoin(
        tx.moveCall({
          target: `${config.package}::incentive_v3::withdraw_with_account_cap_v2`,
          typeArguments: [s.collateralCoinType],
          arguments: [
            tx.object('0x6'),
            tx.object(config.priceOracle),
            tx.object(config.storage),
            tx.object(fresh.collateral.contract.pool),
            tx.pure.u8(fresh.collateral.id),
            withdrawAmount,
            tx.object(config.incentiveV2),
            tx.object(config.incentiveV3),
            accountCap,
            tx.object('0x5')
          ]
        }),
        s.collateralCoinType
      )
      const conversionInput = tx.splitCoins(collateral, [e.withdrawAmount])[0]
      change.push({ coinType: s.collateralCoinType, coin: collateral })
      const output = await convert(conversionInput)
      if (repayChange) tx.mergeCoins(output, [repayChange])
      const remaining = repayFlash(output)
      // Requested principal withdrawal is an on-chain minimum, including all converter/flash costs.
      if (q.action.type === 'remove_principal') minOutputGuard(tx, remaining, q.action.amount)
      for (const minimum of q.estimate.minOutputs) minOutputGuard(tx, remaining, minimum.amount)
      change.push({ coinType: s.principalCoinType, coin: remaining })
    }
    const owner = tx.moveCall({
      target: `${config.package}::account::account_owner`,
      arguments: [accountCap]
    })
    if (q.action.type === 'close') {
      for (const [fn, asset] of [
        ['user_collateral_balance', fresh.collateral.id],
        ['user_loan_balance', fresh.debt.id]
      ] as const) {
        const balance = tx.moveCall({
          target: `${config.package}::logic::${fn}`,
          arguments: [tx.object(config.storage), tx.pure.u8(asset), owner]
        })
        const zero = tx.moveCall({
          target: '0x1::u256::checked_sub',
          arguments: [tx.pure.u256('0'), balance]
        })
        tx.moveCall({
          target: '0x1::option::destroy_some',
          typeArguments: ['u256'],
          arguments: [zero]
        })
      }
    }
    if (q.constraints.maxLeverage !== undefined) {
      const readValue = (fn: string, asset: number) =>
        tx.moveCall({
          target: `${config.package}::logic::${fn}`,
          arguments: [
            tx.object('0x6'),
            tx.object(config.priceOracle),
            tx.object(config.storage),
            tx.pure.u8(asset),
            owner
          ]
        })
      const multiply = (value: TransactionObjectArgument, factor: string) => {
        const product = tx.moveCall({
          target: '0x1::u256::checked_mul',
          arguments: [value, tx.pure.u256(factor)]
        })
        return tx.moveCall({
          target: '0x1::option::destroy_some',
          typeArguments: ['u256'],
          arguments: [product]
        })
      }
      const limit = new BN(q.constraints.maxLeverage).shiftedBy(12).integerValue(BN.ROUND_FLOOR)
      const collateralLimit = multiply(
        readValue('user_collateral_value', fresh.collateral.id),
        limit.minus('1e12').toFixed(0)
      )
      const debtLimit = multiply(readValue('user_loan_value', fresh.debt.id), limit.toFixed(0))
      const withinLimit = tx.moveCall({
        target: '0x1::u256::checked_sub',
        arguments: [collateralLimit, debtLimit]
      })
      tx.moveCall({
        target: '0x1::option::destroy_some',
        typeArguments: ['u256'],
        arguments: [withinLimit]
      })
    }
    tx.moveCall({
      target: `${config.limter}::navi_adaptor::verify_navi_position_healthy`,
      arguments: [
        tx.object('0x6'),
        tx.object(config.storage),
        tx.object(config.priceOracle),
        owner,
        tx.pure.u256(
          new BN(q.constraints.minHealthFactor).shiftedBy(27).integerValue(BN.ROUND_CEIL).toFixed(0)
        )
      ]
    })
    return { coins: change, accountCap, createdAccountCap }
  }
  return { getPosition, quote, buildPTB }
}
