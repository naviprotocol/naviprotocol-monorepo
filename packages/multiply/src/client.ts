import { createChainRateHintReader } from './rate-hints'
import { validateMarketMode, assertModeExposure } from './emode'
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
import { astrosConverter, validateConversion } from './converters'
import { createNaviDataSource, defaultClient } from './data-source'
import { strategies as builtInStrategies } from './strategies'
import {
  MAINNET_CAP_REGISTRY,
  accountCapType,
  assertRegistryUsable,
  normalizeEnv,
  normalizeCapRegistry,
  registryKeyString,
  indexRegistryStrategies,
  registerCreatedCapPTB
} from './cap-registry'
import { chooseConversion, metrics, plan, validateAction } from './planner'
import {
  amountCushion,
  isDustClose,
  positionSides,
  atomPrices,
  borrowCapacity,
  leverageLimit,
  withinSameReserveCapacity,
  supplyCapacity,
  tokenDecimals,
  withinLtv
} from './amounts'
import {
  BN,
  address,
  assertAddressPTB,
  check,
  checksum,
  coinType,
  jsonCopy,
  minOutputGuard,
  sameCoin,
  uint
} from './utils'
import { validateFunding } from './funding'

export function createMultiplyClient(options: MultiplyOptions = {}) {
  const client = options.client ?? defaultClient()
  const converters = options.converters ?? []
  const fallback =
    options.fallbackConverter ?? astrosConverter({ services: options.services, client })
  const readRateHint =
    options.useRateHints === false
      ? undefined
      : (options.rateHintProvider ??
        (options.converters === undefined && options.fallbackConverter === undefined
          ? async (pair) => (env === 'prod' ? createChainRateHintReader(client)(pair) : undefined)
          : undefined))
  const registry = new Map<string, Converter>()
  for (const c of [...converters, fallback]) {
    check(!registry.has(c.id), 'INVALID_ARGUMENT', `Duplicate converter id: ${c.id}`)
    registry.set(c.id, c)
  }
  // Snapshot caller configuration: later mutations must not silently rebind discovery.
  const strategyRegistry = (options.strategies ?? Object.values(builtInStrategies)).map(
    (strategy) => validateStrategy(jsonCopy(strategy))
  )
  check(
    new Set(strategyRegistry.map((strategy) => strategy.id)).size === strategyRegistry.length,
    'INVALID_ARGUMENT',
    'Strategy registry contains duplicate ids'
  )
  const byKey = indexRegistryStrategies(strategyRegistry)
  const retired = new Set((options.retiredRegistryKeys ?? []).map(registryKeyString))
  check(
    [...retired].every((key) => !byKey.has(key)),
    'INVALID_ARGUMENT',
    'Active and retired Registry keys overlap'
  )
  const capRegistry = normalizeCapRegistry(options.capRegistry ?? MAINNET_CAP_REGISTRY)
  // ST-04: the data source owns the env; a second, possibly different env is refused.
  check(
    !(options.dataSource && options.env !== undefined),
    'INVALID_ARGUMENT',
    'env cannot be combined with a custom dataSource; set env on the data source'
  )
  const source: DataSource =
    options.dataSource ??
    createNaviDataSource({
      client,
      services: options.services,
      capRegistry: options.capRegistry === undefined ? undefined : capRegistry,
      strategies: strategyRegistry,
      retiredRegistryKeys: options.retiredRegistryKeys,
      // ST-18: passed through as given; the data source normalizes it (omitted stays omitted, ST-01).
      env: options.env
    })
  const env = normalizeEnv(source.env)
  const explicitRegistry = options.capRegistry !== undefined
  function assertSourceBinding(code = 'INVALID_ARGUMENT') {
    check(
      source.capRegistry &&
        JSON.stringify(normalizeCapRegistry(source.capRegistry)) === JSON.stringify(capRegistry),
      code,
      'DataSource Registry deployment differs from the execution deployment'
    )
  }
  assertSourceBinding()
  async function resolveStrategy(input: Strategy, code = 'INVALID_ARGUMENT'): Promise<Strategy> {
    const supplied = validateStrategy(jsonCopy(input))
    const configured = byKey.get(registryKeyString(supplied.registryKey))
    check(
      configured && (await checksum(configured)) === (await checksum(supplied)),
      code,
      'Strategy differs from the configured Registry binding'
    )
    return supplied
  }
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
      input.emodeId === undefined || (Number.isSafeInteger(input.emodeId) && input.emodeId >= 0),
      'INVALID_ARGUMENT',
      'E-Mode ID must be a nonnegative safe integer'
    )
    registryKeyString(input.registryKey)
    const s = {
      ...input,
      registryKey: { ...input.registryKey },
      principalCoinType: coinType(input.principalCoinType),
      collateralCoinType: coinType(input.collateralCoinType),
      debtCoinType: coinType(input.debtCoinType)
    }
    check(
      (sameCoin(s.principalCoinType, s.debtCoinType) ||
        sameCoin(s.principalCoinType, s.collateralCoinType)) &&
        !sameCoin(s.collateralCoinType, s.debtCoinType),
      'STRATEGY_UNSUPPORTED',
      'Principal must equal collateral or debt, with distinct collateral and debt'
    )
    s.acceptedInputCoinTypes = (s.acceptedInputCoinTypes ?? [s.principalCoinType]).map(coinType)
    check(
      s.acceptedInputCoinTypes.length > 0 &&
        s.acceptedInputCoinTypes[0] === s.principalCoinType &&
        new Set(s.acceptedInputCoinTypes).size === s.acceptedInputCoinTypes.length &&
        s.acceptedInputCoinTypes.every(
          (type) => type === s.collateralCoinType || type === s.debtCoinType
        ),
      'STRATEGY_UNSUPPORTED',
      'Accepted inputs must be distinct strategy assets with principal first'
    )
    return s
  }
  async function loadCaps(owner: string) {
    assertSourceBinding('STALE_QUOTE')
    const caps = await source.listAccountCaps(owner)
    const keys = new Set<string>(),
      ids = new Set<string>(),
      owners = new Set<string>()
    return caps
      .map((cap) => {
        const key = registryKeyString(cap.registryKey)
        const configured = byKey.get(key)
        const id = address(cap.id),
          accountOwner = address(cap.accountOwner)
        check(
          id !== address('0x0') && accountOwner !== address('0x0'),
          'INVALID_ACCOUNT_CAP',
          'Zero Cap identity'
        )
        check(
          !keys.has(key) && !ids.has(id) && !owners.has(accountOwner),
          'DUPLICATE_ACCOUNT_CAP',
          'Duplicate strategy, Cap or lending account in Registry'
        )
        keys.add(key)
        ids.add(id)
        owners.add(accountOwner)
        if (retired.has(key)) return null
        check(configured, 'UNSUPPORTED_REGISTRY_STRATEGY', 'Unknown registered Multiply strategy')
        check(
          configured.id === cap.strategyId,
          'INVALID_ACCOUNT_CAP',
          'Cap numeric binding differs from strategy ID'
        )
        check(
          cap.transient === undefined || cap.transient === true,
          'INVALID_ACCOUNT_CAP',
          'Cap transient marker must be true or absent'
        )
        return { ...cap, id, accountOwner, registryKey: { ...cap.registryKey } }
      })
      .filter((cap): cap is AccountCap => cap !== null)
  }
  function findCap(caps: AccountCap[], strategy: Strategy) {
    const key = registryKeyString(strategy.registryKey)
    return caps.find((cap) => registryKeyString(cap.registryKey) === key)
  }
  async function getPosition(
    owner: string,
    query: { strategy?: Strategy } = {}
  ): Promise<Position[]> {
    owner = address(owner)
    const result: Position[] = []
    const caps = await loadCaps(owner)
    for (const supplied of query.strategy ? [query.strategy] : strategyRegistry) {
      const strategy = await resolveStrategy(supplied)
      const cap = findCap(caps, strategy)
      if (!cap) continue
      const market = await source.readMarket(strategy),
        amounts = await source.readPosition(cap, strategy, market)
      validateMarketMode(strategy, market)
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
    const budget = { deadline: Date.now() + 45_000, count: 0 }
    owner = address(owner)
    check(owner !== address('0x0'), 'INVALID_ARGUMENT', 'Multiply owner cannot be zero')
    validateAction(action, constraints)
    const strategy = await resolveStrategy(suppliedStrategy)
    if (action.type === 'open' || action.type === 'add_principal') {
      const inputCoinType = coinType(action.inputCoinType ?? strategy.principalCoinType)
      check(
        strategy.acceptedInputCoinTypes!.includes(inputCoinType),
        'UNSUPPORTED_INPUT_COIN',
        'Input coin is not accepted by this strategy'
      )
      action = { ...action, inputCoinType }
    }
    const cap = findCap(await loadCaps(owner), strategy)
    check(
      cap || action.type === 'open',
      'POSITION_NOT_FOUND',
      'Only open may create a Multiply Cap'
    )
    const market = await source.readMarket(strategy)
    validateMarketMode(strategy, market)
    const snapshot = cap
      ? await source.readPosition(cap, strategy, market)
      : { collateralAmount: '0', debtAmount: '0' }
    uint(snapshot.collateralAmount)
    uint(snapshot.debtAmount)
    const sides = cap ? positionSides(snapshot, market) : { collateral: false, debt: false }
    const empty = !sides.collateral && !sides.debt
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
      const healthRatio = new BN(market.liquidationThreshold).div(
        new BN(market.borrowWeight).times(constraints.minHealthFactor)
      )
      const ratio = new BN(1).minus(new BN(1).div(action.targetLeverage))
      const prices = atomPrices(market)
      const reducing =
        !['open', 'add_principal'].includes(action.type) &&
        ratio
          .times(snapshot.collateralAmount)
          .times(prices.collateral)
          .lte(new BN(snapshot.debtAmount).times(prices.debt))
      check(
        ratio.lte(healthRatio) &&
          (ratio.lte(new BN(market.ltv).div(market.borrowWeight)) || reducing),
        'CONSTRAINT_VIOLATION',
        'Target leverage exceeds protocol or health factor limits'
      )
    }
    const fee = await source.readBorrowFeeBps(market, cap?.accountOwner)
    const ratePair = { coinIn: strategy.debtCoinType, coinOut: strategy.collateralCoinType }
    const rateProviders = converters.filter((c) => c.supports(ratePair.coinIn, ratePair.coinOut))
    const rateProvider =
      rateProviders.length === 0
        ? fallback
        : rateProviders.length === 1
          ? rateProviders[0]
          : undefined
    const hint = async (pair: typeof ratePair) => {
      const value = await readRateHint!(pair)
      // A late optional hint is discarded, never promoted into an executable price.
      return value && Number.isSafeInteger(value.expiresAt) && value.expiresAt <= Date.now()
        ? undefined
        : value
    }
    const planned = await plan(
      strategy,
      action,
      constraints,
      snapshot,
      market,
      fee,
      (req) => chooseConversion(req, converters, fallback),
      readRateHint
        ? () => hint(ratePair)
        : options.useRateHints !== false && rateProvider?.getRateHint
          ? () => rateProvider.getRateHint!(ratePair)
          : undefined,
      !readRateHint && options.useRateHints !== false && rateProvider?.getStakingSnapshot
        ? async () => {
            const snapshot = await rateProvider.getStakingSnapshot!(ratePair)
            if (snapshot)
              check(
                snapshot.converterId === rateProvider.id,
                'INVALID_CONVERSION',
                'Native snapshot provider mismatch'
              )
            return snapshot
          }
        : undefined,
      !readRateHint &&
        options.useRateHints !== false &&
        !options.disableRedemptionSnapshot &&
        rateProvider?.getRedemptionSnapshot
        ? async () => {
            const snapshot = await rateProvider.getRedemptionSnapshot!({
              coinIn: ratePair.coinOut,
              coinOut: ratePair.coinIn
            })
            if (snapshot)
              check(
                snapshot.converterId === rateProvider.id,
                'INVALID_CONVERSION',
                'Redemption snapshot provider mismatch'
              )
            return snapshot
          }
        : undefined,
      budget,
      readRateHint ? () => hint({ coinIn: ratePair.coinOut, coinOut: ratePair.coinIn }) : undefined,
      options.useRateHints !== false
    )
    for (const conversion of planned.execution.conversions) {
      const converter = registry.get(conversion.converterId)!
      const remaining = budget.deadline - Date.now()
      if (converter.enrichFees && remaining > 1) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          conversion.fees = await Promise.race([
            converter.enrichFees(conversion),
            new Promise<undefined>((resolve) => {
              timer = setTimeout(() => resolve(undefined), Math.min(1500, remaining - 1))
            })
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      validateConversion(
        conversion,
        {
          coinIn: conversion.input.coinType,
          coinOut: conversion.expectedOutput.coinType,
          amountIn: conversion.input.amount,
          slippageBps: constraints.maxSlippageBps
        },
        converter.id
      )
    }
    if (!cap) {
      // ST-05/ST-06: a new Cap is registered with the env's Cap type in a Registry valid for it.
      assertRegistryUsable(env, explicitRegistry)
      accountCapType(env)
    }
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
        env,
        capRegistry: { ...capRegistry },
        accountCap: cap
          ? { kind: 'existing', ...cap }
          : { kind: 'create', registryKey: { ...strategy.registryKey } },
        checksum: ''
      }
    }
    q.execution.checksum = await checksum(q)
    return jsonCopy(q)
  }
  async function readLiveBuildState(q: MultiplyQuote, inputs: BuildInputs) {
    const e = q.execution,
      s = q.strategy
    const cap = findCap(await loadCaps(q.address), s)
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
    validateMarketMode(s, fresh)
    assertModeExposure(q.action, q.execution, fresh)
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
        fresh.flash.poolId === e.market.flash.poolId &&
        tokenDecimals(fresh.collateral) === tokenDecimals(e.market.collateral) &&
        tokenDecimals(fresh.debt) === tokenDecimals(e.market.debt),
      'STALE_QUOTE',
      'Pool configuration changed'
    )
    const now = cap
      ? await source.readPosition(cap, s, fresh)
      : { collateralAmount: '0', debtAmount: '0' }
    if (cap) {
      const current = positionSides(now, fresh)
      check(
        (q.action.type === 'open') === (!current.collateral && !current.debt),
        'STALE_QUOTE',
        'Position no longer satisfies the action'
      )
      // Older quotes lack exact sub-atom balances. A native zero is ambiguous on
      // the collateral side, except for an open that required a truly empty Cap.
      if (q.action.type !== 'open') {
        check(
          e.snapshot.protocolCollateralAmount !== undefined ||
            tokenDecimals(fresh.collateral) >= 9 ||
            e.snapshot.collateralAmount !== '0',
          'STALE_QUOTE',
          'Quote lacks precise collateral state'
        )
        const quoted = positionSides(e.snapshot, fresh)
        check(
          quoted.collateral === current.collateral && quoted.debt === current.debt,
          'STALE_QUOTE',
          'Position crossed a zero balance'
        )
      }
      if (q.action.type === 'close' && isDustClose(s, e.snapshot, fresh))
        check(
          isDustClose(s, now, fresh),
          'STALE_QUOTE',
          'Collateral became transferable; request a new quote'
        )
    }
    // Interest may accrue; position mutations need a new quote. On-chain checks remain authoritative.
    const collateralDelta = new BN(now.collateralAmount).minus(e.snapshot.collateralAmount)
    const debtDelta = new BN(now.debtAmount).minus(e.snapshot.debtAmount)
    check(
      collateralDelta.gte(0) &&
        collateralDelta.lte(
          new BN(e.snapshot.collateralAmount).times('0.0001').plus(amountCushion(fresh.collateral))
        ) &&
        debtDelta.gte(0) &&
        debtDelta.lte(
          new BN(e.snapshot.debtAmount).times('0.0001').plus(amountCushion(fresh.debt))
        ),
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
    const liveLimit = leverageLimit(
      q.constraints.maxLeverage,
      q.action,
      e.direction,
      metrics(now, fresh).leverage
    )
    if (liveLimit && risk.leverage)
      check(
        new BN(risk.leverage).lte(liveLimit),
        'STALE_QUOTE',
        'Updated market exceeds maximum leverage'
      )
    check(
      withinLtv(projected, now, fresh, e.direction !== 'increase'),
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
      new BN(e.collateralAfter).minus(e.snapshot.collateralAmount).lte(supplyCapacity(fresh)),
      'CAPACITY_EXCEEDED',
      'Supply capacity changed'
    )
    check(
      new BN(e.borrowAmount).plus(e.borrowFee).lte(borrowCapacity(fresh)),
      'CAPACITY_EXCEEDED',
      'Borrow liquidity changed'
    )
    check(
      withinSameReserveCapacity(s, e, fresh),
      'CAPACITY_EXCEEDED',
      'Flash and borrow from the same reserve exceed its cash'
    )
    return { fresh, now }
  }

  async function assemblePTB(
    tx: Transaction,
    suppliedQuote: MultiplyQuote,
    inputs: BuildInputs,
    fromStoredQuote: boolean
  ): Promise<BuildResult> {
    const q = jsonCopy(suppliedQuote)
    check(
      q.execution?.version === 4,
      'INVALID_QUOTE',
      'Unknown quote version; request a fresh quote'
    )
    const expectedHash = q.execution.checksum
    q.execution.checksum = ''
    check(
      expectedHash === (await checksum(q)),
      'INVALID_QUOTE',
      'Quote contents have changed; request a fresh quote'
    )
    q.execution.checksum = expectedHash
    // ST-20..ST-23: a quote is bound to the env it was made for, whichever entry builds it, before anything else.
    check(
      q.execution.env !== undefined,
      'INVALID_QUOTE',
      'Quote has no NAVI env (made by an older SDK); request a fresh quote'
    )
    check(
      q.execution.env === env,
      'INVALID_QUOTE',
      `Quote was made for NAVI env ${String(q.execution.env)}; this client targets ${env}`
    )
    check(
      Number.isSafeInteger(q.expiresAt) && q.expiresAt > Date.now(),
      'QUOTE_EXPIRED',
      'Multiply quote expired'
    )
    check(
      address(q.address) !== address('0x0'),
      'INVALID_ARGUMENT',
      'Multiply owner cannot be zero'
    )
    await resolveStrategy(q.strategy, 'STALE_QUOTE')
    check(
      (await checksum(q.execution.capRegistry)) === (await checksum(capRegistry)),
      'STALE_QUOTE',
      'Registry deployment changed since quote'
    )
    check(
      registryKeyString(q.execution.accountCap.registryKey) ===
        registryKeyString(q.strategy.registryKey),
      'INVALID_QUOTE',
      'Quote Cap key differs from strategy'
    )
    const sender = tx.getData().sender
    check(
      !sender || address(sender) === address(q.address),
      'INVALID_INPUTS',
      'Transaction sender differs from quote wallet'
    )
    validateAction(q.action, q.constraints)
    const e = q.execution,
      s = q.strategy
    validateFunding(q)
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
    const { fresh, now } = fromStoredQuote
      ? { fresh: e.market, now: e.snapshot }
      : await readLiveBuildState(q, inputs)
    validateMarketMode(s, fresh)
    assertModeExposure(q.action, e, fresh)
    // ST-19: a created Cap needs a Registry valid for this env; refused before any command.
    if (e.accountCap.kind === 'create') assertRegistryUsable(env, explicitRegistry)
    // A transient Cap has no object to resolve: only the caller's transaction argument exists.
    const transientCap = e.accountCap.kind === 'existing' && e.accountCap.transient === true
    check(
      !transientCap || inputs.accountCap !== undefined,
      'INVALID_INPUTS',
      'A transient AccountCap must be supplied as a transaction argument'
    )
    // All preflight checks precede mutation. A later network/build failure requires discarding the PTB.
    tx.setSenderIfNotSet(q.address)
    if (!fromStoredQuote || options.prepareOracleForSimulation !== false)
      await source.prepareOracle(tx, s, fresh)
    const config = fresh.config
    const createdAccountCap =
      e.accountCap.kind === 'create'
        ? tx.moveCall({ target: `${config.package}::lending::create_account` })
        : undefined
    const accountCap =
      createdAccountCap ?? inputs.accountCap ?? tx.object((e.accountCap as AccountCap).id)
    if (e.accountCap.kind === 'existing' && inputs.accountCap !== undefined && !transientCap) {
      // A supplied Cap is a transaction argument (e.g. one a vault extracts earlier in the PTB), so
      // its identity cannot be proven here. Every preflight check was made for the quoted Cap: bind
      // the argument to that Cap's lending account on chain, before any lending call uses it. Only a
      // Cap its data source declared transient (created in this PTB, no identity yet) is exempt.
      assertAddressPTB(
        tx,
        tx.moveCall({
          target: `${config.package}::account::account_owner`,
          arguments: [accountCap]
        }),
        e.accountCap.accountOwner
      )
    }
    if (createdAccountCap) {
      if (s.emodeId !== undefined)
        tx.moveCall({
          target: `${config.package}::lending::enter_emode_with_account_cap`,
          arguments: [tx.object(config.storage), tx.pure.u64(s.emodeId), createdAccountCap]
        })
      registerCreatedCapPTB(tx, createdAccountCap, s.registryKey, capRegistry, accountCapType(env))
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
        target: `${fresh.flash.config.package}::lending::flash_loan_with_account_cap_v2`,
        typeArguments: [s.debtCoinType],
        arguments: [
          tx.object(fresh.flash.config.flashloanConfig),
          tx.object(fresh.flash.poolId),
          tx.pure.u64(e.flashAmount),
          accountCap,
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
              target: `${fresh.flash.config.package}::lending::flash_repay_with_account_cap`,
              typeArguments: [s.debtCoinType],
              arguments: [
                tx.object('0x6'),
                tx.object(fresh.flash.config.storage),
                tx.object(fresh.flash.poolId),
                receipt,
                asBalance(coin, s.debtCoinType),
                accountCap
              ]
            }),
            s.debtCoinType
          )
        : coin
    const convert = async (
      coin: TransactionObjectArgument,
      conversion: (typeof e.conversions)[number]
    ) => {
      const built = await registry.get(conversion.converterId)!.buildPTB(tx, conversion, coin, {
        changeRecipient: q.address
      })
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
      if (e.funding.kind !== 'none') {
        const contribution = exact(e.funding.input.coinType, e.funding.input.amount)
        if (e.funding.kind === 'collateral') deposit(contribution)
        else if (funds) tx.mergeCoins(funds, [contribution])
        else funds = contribution
      }
      for (const conversion of e.conversions) {
        check(funds, 'INVALID_QUOTE', 'Missing conversion funding')
        deposit(await convert(funds, conversion))
        funds = undefined
      }
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
        if (isDustClose(s, e.snapshot, fresh)) {
          // The user may leave the wallet open while interest crosses into a
          // transferable atom. Enforce the quoted dust domain at execution too.
          for (const [left, right] of [
            [balance, tx.pure.u256('1')],
            [tx.pure.u256('999'), balance]
          ]) {
            const within = tx.moveCall({
              target: '0x1::u256::checked_sub',
              arguments: [left, right]
            })
            tx.moveCall({
              target: '0x1::option::destroy_some',
              typeArguments: ['u256'],
              arguments: [within]
            })
          }
        }
        const optional = tx.moveCall({ target: '0x1::u256::try_as_u64', arguments: [balance] })
        withdrawAmount = tx.moveCall({
          target: '0x1::option::destroy_some',
          typeArguments: ['u64'],
          arguments: [optional]
        })
        if (tokenDecimals(fresh.collateral) !== 9) {
          withdrawAmount = tx.moveCall({
            target: `${config.package}::pool::unnormal_amount`,
            typeArguments: [s.collateralCoinType],
            arguments: [tx.object(fresh.collateral.contract.pool), withdrawAmount]
          })
          if (tokenDecimals(fresh.collateral) < 9) {
            // Request at least the full normalized balance, including sub-atom
            // interest. NAVI clips withdrawals to that balance, then emits native coins.
            const rounded = tx.moveCall({
              target: '0x1::u64::checked_add',
              arguments: [withdrawAmount, tx.pure.u64('1')]
            })
            withdrawAmount = tx.moveCall({
              target: '0x1::option::destroy_some',
              typeArguments: ['u64'],
              arguments: [rounded]
            })
          }
        }
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
      let debtOutput: TransactionObjectArgument | undefined
      for (const conversion of e.conversions) {
        const conversionInput = tx.splitCoins(collateral, [conversion.input.amount])[0]
        debtOutput = await convert(conversionInput, conversion)
      }
      if (repayChange) {
        if (debtOutput) tx.mergeCoins(debtOutput, [repayChange])
        else debtOutput = repayChange
      }
      if (debtOutput) debtOutput = repayFlash(debtOutput)
      const principalOutput = sameCoin(s.principalCoinType, s.collateralCoinType)
        ? collateral
        : debtOutput
      const dust =
        q.action.type === 'close' && isDustClose(s, now, fresh) && isDustClose(s, e.snapshot, fresh)
      if (!dust) {
        check(principalOutput, 'INVALID_QUOTE', 'Missing principal output')
        if (q.action.type === 'remove_principal')
          minOutputGuard(tx, principalOutput, q.action.amount)
      }
      for (const minimum of q.estimate.minOutputs) {
        if (dust && minimum.amount === '0' && sameCoin(minimum.coinType, s.principalCoinType))
          continue
        const coin = sameCoin(minimum.coinType, s.collateralCoinType) ? collateral : debtOutput
        check(coin, 'INVALID_QUOTE', 'Missing minimum output coin')
        minOutputGuard(tx, coin, minimum.amount)
      }
      change.push({ coinType: s.collateralCoinType, coin: collateral })
      if (debtOutput) change.push({ coinType: s.debtCoinType, coin: debtOutput })
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
    // Not emitted for repay, top-up and close: they only lower leverage (leverageLimit).
    const chainLimit = leverageLimit(
      q.constraints.maxLeverage,
      q.action,
      e.direction,
      metrics(now, fresh).leverage
    )
    if (chainLimit) {
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
      // The same bound the quote accepted, so a plan at the limit is not refused on chain.
      const limit = chainLimit.shiftedBy(12).integerValue(BN.ROUND_FLOOR)
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
  function buildPTB(tx: Transaction, q: MultiplyQuote, inputs: BuildInputs) {
    return assemblePTB(tx, q, inputs, false)
  }

  /** Assemble a server-stored plan for full simulation and settlement reconciliation before signing. */
  function buildPTBForSimulation(tx: Transaction, q: MultiplyQuote, coins: BuildInputs['coins']) {
    return assemblePTB(tx, q, { coins }, true)
  }

  return { getPosition, quote, buildPTB, buildPTBForSimulation }
}
