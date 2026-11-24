import { MAINNET_CAP_REGISTRY } from '../src/cap-registry'
import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { ReserveDataInfo, UserStateInfo } from '@naviprotocol/lending'
import type {
  Action,
  Converter,
  DataSource,
  MarketSnapshot,
  PositionAmounts,
  Strategy
} from '../src/types'
import { createMultiplyClient } from '../src/client'
import { createNaviDataSource } from '../src/data-source'
import { amountCushion, lendingToRaw } from '../src/amounts'
import { checksum, coinType, BN } from '../src/utils'

const owner = '0x' + 'a'.repeat(64)
const object = '0x' + 'b'.repeat(64)
const collateralType = coinType('0x11::fixture::COLLATERAL')
const debtType = coinType('0x22::fixture::DEBT')
const constraints = { minHealthFactor: '1.1', maxSlippageBps: 0, maxLeverage: '3' }
const raw = (value: string | number, decimals: number) =>
  new BN(value).shiftedBy(decimals).toFixed(0)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function fixture(
  collateralDecimals: number,
  debtDecimals: number,
  existing = false,
  collateralPrincipal = false,
  allowCollateralDustClose = false,
  emodeId?: number,
  marketName = 'external-market'
) {
  const strategy: Strategy = {
    id: `external-pair-${collateralDecimals}-${debtDecimals}`,
    market: marketName,
    allowCollateralDustClose,
    ...(emodeId !== undefined ? { emodeId } : {}),
    registryKey: { strategyNumericId: '100', strategyVersion: '1' },
    principalCoinType: collateralPrincipal ? collateralType : debtType,
    acceptedInputCoinTypes: collateralPrincipal
      ? [collateralType, debtType]
      : [debtType, collateralType],
    collateralCoinType: collateralType,
    debtCoinType: debtType
  }
  const config = {
    package: object,
    storage: object,
    priceOracle: object,
    incentiveV2: object,
    incentiveV3: object,
    limter: object,
    flashloanConfig: object
  }
  const market = {
    config,
    ...(emodeId !== undefined ? { emode: { id: emodeId, active: true } } : {}),
    collateral: {
      id: 1,
      contract: { pool: object },
      token: { decimals: collateralDecimals },
      leftSupply: '1000000'
    },
    debt: {
      id: 2,
      contract: { pool: object },
      token: { decimals: debtDecimals },
      availableBorrow: raw(1000000, 9),
      // Pool cash, raw in the coin's own decimals (lending API `balance`).
      balance: raw(1000000, debtDecimals)
    },
    collateralPrice: '2',
    debtPrice: '1',
    ltv: '0.8',
    liquidationThreshold: '0.9',
    borrowWeight: '1',
    flash: { config, poolId: object, min: '0', max: raw(1000000, debtDecimals), feeBps: '0' },
    observedAt: Date.now()
  } as MarketSnapshot
  let position: PositionAmounts = {
    collateralAmount: raw(100, collateralDecimals),
    debtAmount: raw(100, debtDecimals)
  }
  const cap = {
    id: object,
    accountOwner: object,
    strategyId: strategy.id,
    registryKey: strategy.registryKey
  }
  const source: DataSource = {
    capRegistry: MAINNET_CAP_REGISTRY,
    listAccountCaps: async () => (existing ? [cap] : []),
    readMarket: async () => ({ ...clone(market), observedAt: Date.now() }),
    readPosition: async () => clone(position),
    readBorrowFeeBps: async () => '0',
    prepareOracle: async () => {}
  }
  const converter: Converter = {
    id: 'fixture',
    supports: () => true,
    async quote(req) {
      const increase = req.coinIn === debtType
      const amount = new BN(req.amountIn)
        .shiftedBy(-(increase ? debtDecimals : collateralDecimals))
        .times(increase ? '0.5' : '2')
        .shiftedBy(increase ? collateralDecimals : debtDecimals)
        .integerValue(BN.ROUND_FLOOR)
        .toFixed(0)
      return {
        converterId: 'fixture',
        input: { coinType: req.coinIn, amount: req.amountIn },
        expectedOutput: { coinType: req.coinOut, amount },
        minOutput: { coinType: req.coinOut, amount },
        expiresAt: Date.now() + 120000,
        data: null
      }
    },
    async buildPTB(tx, q, coin) {
      return {
        coinOut: tx.moveCall({
          target: `${object}::fixture::swap`,
          typeArguments: [q.input.coinType, q.expectedOutput.coinType],
          arguments: [coin]
        }),
        change: []
      }
    }
  }
  const engine = createMultiplyClient({
    dataSource: source,
    strategies: [strategy],
    converters: [],
    fallbackConverter: converter
  })
  return {
    strategy,
    market,
    source,
    converter,
    engine,
    cap,
    setExisting: (value: boolean) => {
      existing = value
    },
    setPosition: (p: typeof position) => {
      position = p
    }
  }
}

async function build(
  f: ReturnType<typeof fixture>,
  q: Awaited<ReturnType<ReturnType<typeof createMultiplyClient>['quote']>>
) {
  const tx = new Transaction()
  const built = await f.engine.buildPTB(tx, q, {
    coins: q.estimate.inputs.map((input, i) => ({
      coinType: input.coinType,
      coin: tx.object(`0x${i + 100}`)
    }))
  })
  return { tx, built }
}

it.each([false, true])(
  'builds the same PTB for simulation without live preflight (existing Cap: %s)',
  async (existing) => {
    const f = fixture(9, 6, existing)
    const action: Action = existing
      ? { type: 'repay', amount: raw(1, 6) }
      : { type: 'open', amount: raw(100, 6), targetLeverage: '2' }
    const q = await f.engine.quote(owner, f.strategy, action, constraints)
    const { tx: normal } = await build(f, q)
    for (const method of [
      'listAccountCaps',
      'readMarket',
      'readPosition',
      'readBorrowFeeBps'
    ] as const) {
      vi.spyOn(f.source, method).mockRejectedValue(new Error('unexpected live preflight'))
    }
    const tx = new Transaction()
    await f.engine.buildPTBForSimulation(
      tx,
      q,
      q.estimate.inputs.map((input, i) => ({
        coinType: input.coinType,
        coin: tx.object(`0x${i + 100}`)
      }))
    )
    expect(tx.getData()).toEqual(normal.getData())
    await expect(build(f, q)).rejects.toThrow('unexpected live preflight')
  }
)

describe.each([
  [9, 6],
  [6, 9],
  [8, 6],
  [9, 9]
])('injected strategy: %i/%i decimals', (cd, dd) => {
  it('opens an unbundled pair, values native amounts, and builds its PTB', async () => {
    const f = fixture(cd, dd)
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: raw(100, dd), targetLeverage: '2' },
      constraints
    )
    expect(q.execution.version).toBe(4)
    expect(new BN(q.execution.collateralAfter).minus(raw(100, cd)).abs().lte(2)).toBe(true)
    expect(new BN(q.execution.debtAfter).minus(raw(100, dd)).abs().lte(2)).toBe(true)
    expect(Number(q.estimate.leverage)).toBeCloseTo(2, 6)
    expect(Number(q.estimate.healthFactor)).toBeCloseTo(1.8, 6)
    const { built } = await build(f, q)
    expect(built.createdAccountCap).toBeDefined()
  })

  it('discovers only the supplied registry and preserves native position units', async () => {
    const f = fixture(cd, dd, true)
    const [p] = await f.engine.getPosition(owner)
    expect(p.strategy.id).toBe(f.strategy.id)
    expect(p.collateralAmount).toBe(raw(100, cd))
    expect(p.debtAmount).toBe(raw(100, dd))
    expect(Number(p.leverage)).toBe(2)
  })

  it.each([
    ['add_principal', '2'],
    ['remove_principal', '2'],
    ['set_leverage', '2.5'],
    ['set_leverage', '1.5'],
    ['set_leverage', '1'],
    ['repay', undefined],
    ['add_collateral', undefined],
    ['close', undefined]
  ])('%s at %s supports quote and build', async (type, leverage) => {
    const f = fixture(cd, dd, true)
    const action = {
      type,
      ...(leverage ? { targetLeverage: leverage } : {}),
      ...(['add_principal', 'remove_principal', 'repay', 'add_collateral'].includes(type)
        ? { amount: raw(10, type === 'add_collateral' ? cd : dd) }
        : {})
    } as Action
    const q = await f.engine.quote(owner, f.strategy, action, constraints)
    if (leverage) expect(Number(q.estimate.leverage)).toBeCloseTo(Number(leverage), 4)
    if (type === 'close') {
      expect(q.execution.collateralAfter).toBe('0')
      expect(q.execution.debtAfter).toBe('0')
      expect(q.estimate.outputs[0].coinType).toBe(debtType)
      expect(new BN(q.estimate.outputs[0].amount).shiftedBy(-dd).toNumber()).toBeCloseTo(100, 5)
    }
    const { tx } = await build(f, q)
    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => c.MoveCall.function)
    if (type === 'close' && cd !== 9) expect(calls).toContain('unnormal_amount')
    if (type === 'close' && cd < 9) expect(calls).toContain('checked_add')
  })

  it('checks normalized borrow capacity and whole-token supply capacity at quote and build', async () => {
    const f = fixture(cd, dd)
    const action: Action = { type: 'open', amount: raw(100, dd), targetLeverage: '2' }
    const q = await f.engine.quote(owner, f.strategy, action, constraints)
    f.market.debt.availableBorrow = raw(99, 9)
    await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED'
    })
    await expect(build(f, q)).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' })
    f.market.debt.availableBorrow = raw(100, 9)
    f.market.collateral.leftSupply = '99'
    await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED'
    })
    await expect(build(f, q)).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' })
    f.market.collateral.leftSupply = '100'
    await expect(build(f, q)).resolves.toBeDefined()
  })

  it('rechecks mixed-decimal risk and drift before mutating a PTB', async () => {
    const f = fixture(cd, dd, true)
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'set_leverage', targetLeverage: '2.5' },
      constraints
    )
    f.market.collateralPrice = '0.5'
    await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
    f.market.collateralPrice = '2'
    f.setPosition({ collateralAmount: raw(100, cd), debtAmount: raw(101, dd) })
    await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
  })

  it.each(['repay', 'add_collateral', 'close', 'set_leverage'])(
    'permits %s after borrowing/supply capacity is withdrawn without relaxing HF',
    async (type) => {
      const f = fixture(cd, dd, true)
      f.market.ltv = '0'
      f.market.debt.availableBorrow = '0'
      f.market.collateral.leftSupply = type === 'add_collateral' ? '100' : '-10'
      const action = {
        type,
        ...(type === 'set_leverage' ? { targetLeverage: '1.5' } : {}),
        ...(['repay', 'add_collateral'].includes(type)
          ? { amount: raw(10, type === 'repay' ? dd : cd) }
          : {})
      } as Action
      const q = await f.engine.quote(owner, f.strategy, action, constraints)
      await expect(build(f, q)).resolves.toBeDefined()
      if (type !== 'close') {
        f.market.liquidationThreshold = '0.1'
        await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toMatchObject({
          code: 'CONSTRAINT_VIOLATION'
        })
      }
      await expect(
        f.engine.quote(
          owner,
          f.strategy,
          { type: 'set_leverage', targetLeverage: '2.5' },
          constraints
        )
      ).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATION' })
    }
  )
})

it('rejects duplicate configured IDs and snapshots caller registry input', async () => {
  const f = fixture(9, 6, true)
  expect(() =>
    createMultiplyClient({ dataSource: f.source, strategies: [f.strategy, f.strategy] })
  ).toThrow('duplicate ids')
  const configured = clone(f.strategy)
  const engine = createMultiplyClient({ dataSource: f.source, strategies: [configured] })
  configured.id = 'mutated-after-initialization'
  expect((await engine.getPosition(owner))[0].strategy.id).toBe(f.strategy.id)
})

it('converts normalized fractional interest conservatively and scales the drift cushion', () => {
  expect(lendingToRaw('1234567890', 6)).toBe('1234567')
  expect(lendingToRaw('1234567890', 6, true)).toBe('1234568')
  expect(lendingToRaw('1234567890', 9)).toBe('1234567890')
  expect(lendingToRaw('1234567890', 12)).toBe('1234567890000')
  expect(amountCushion(fixture(9, 6).market.debt).toFixed()).toBe('1')
  expect(amountCushion(fixture(9, 6).market.collateral).toFixed()).toBe('1000')
})

it('rejects unsupported principal and invalid E-Mode IDs without hardcoding pair IDs', () => {
  const f = fixture(9, 6)
  expect(() =>
    createMultiplyClient({
      strategies: [{ ...f.strategy, principalCoinType: '0x33::fixture::THIRD' }]
    })
  ).toThrow('Principal must equal collateral or debt')
  expect(() => createMultiplyClient({ strategies: [{ ...f.strategy, emodeId: -1 }] })).toThrow(
    'E-Mode'
  )
})

it('rejects a tiny position when native precision cannot achieve its requested leverage', async () => {
  const f = fixture(0, 0)
  await expect(
    f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: '2', targetLeverage: '1.3' },
      constraints
    )
  ).rejects.toMatchObject({ code: 'NO_CONVERGENCE' })
})

it('refreshes a stale solver bracket when the route moves, preserving the target bound', async () => {
  const f = fixture(6, 9)
  let calls = 0
  const original = f.converter.quote
  f.converter.quote = async (req) => {
    const q = await original(req)
    calls++
    // An adverse route at the first secant sample, then a stable improved route.
    // The resulting root is outside the old bracket; reducing it to one atom is invalid.
    const factor = calls < 3 ? '1' : calls === 3 ? '0.99' : '1.01'
    const amount = new BN(q.expectedOutput.amount)
      .times(factor)
      .integerValue(BN.ROUND_FLOOR)
      .toFixed(0)
    return {
      ...q,
      expectedOutput: { ...q.expectedOutput, amount },
      minOutput: { ...q.minOutput, amount }
    }
  }
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: raw(100, 9), targetLeverage: '2' },
    constraints
  )
  expect(Math.abs(Number(q.estimate.leverage) - 2)).toBeLessThanOrEqual(0.0002)
  expect(calls).toBeGreaterThan(4)
  expect(calls).toBeLessThanOrEqual(32)
  await expect(build(f, q)).resolves.toBeDefined()
})

it.each([
  [6, 9, 90],
  [6, 9, 95],
  [6, 9, 99],
  [9, 6, 90],
  [9, 6, 95],
  [9, 6, 99]
])(
  'converges after withdrawing most equity in a %i/%i position (%i tokens)',
  async (cd, dd, payout) => {
    const f = fixture(cd, dd, true)
    const original = f.converter.quote
    let calls = 0
    f.converter.quote = async (req) => {
      const q = await original(req)
      calls++
      const amount = new BN(q.expectedOutput.amount)
        .times('0.999')
        .integerValue(BN.ROUND_FLOOR)
        .toFixed(0)
      return {
        ...q,
        expectedOutput: { ...q.expectedOutput, amount },
        minOutput: { ...q.minOutput, amount }
      }
    }
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'remove_principal', amount: raw(payout, dd), targetLeverage: '2' },
      constraints
    )
    expect(Math.abs(Number(q.estimate.leverage) - 2)).toBeLessThanOrEqual(0.0002)
    expect(calls).toBeGreaterThan(2)
    expect(calls).toBeLessThanOrEqual(32)
    await expect(build(f, q)).resolves.toBeDefined()
  }
)

it('does not round a representable small mixed-precision position down to 1x', async () => {
  const f = fixture(6, 9)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: '2000', targetLeverage: '2' },
    constraints
  )
  expect(q.estimate.leverage).toBe('2.000000000000')
  await expect(build(f, q)).resolves.toBeDefined()
})

it('fails within the quote-count limit when every new route moves away from the target', async () => {
  const f = fixture(6, 9)
  let calls = 0
  const original = f.converter.quote
  f.converter.quote = async (req) => {
    const q = await original(req)
    calls++
    // A provider whose route changes with each requested size, maintaining a
    // gap around the target: no returned quote can actually achieve 2x.
    const factor = new BN(req.amountIn).lte(raw(200, 9)) ? '1.01' : '0.99'
    const amount = new BN(q.expectedOutput.amount)
      .times(factor)
      .integerValue(BN.ROUND_FLOOR)
      .toFixed(0)
    return {
      ...q,
      expectedOutput: { ...q.expectedOutput, amount },
      minOutput: { ...q.minOutput, amount }
    }
  }
  await expect(
    f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: raw(100, 9), targetLeverage: '2' },
      constraints
    )
  ).rejects.toMatchObject({ code: 'NO_CONVERGENCE' })
  expect(calls).toBeLessThanOrEqual(32)
})

it('times out a stalled read-only converter without waiting beyond the solver budget', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture(6, 9)
    let began!: () => void
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    f.converter.quote = () => {
      began()
      return new Promise(() => {})
    }
    const rejected = expect(
      f.engine.quote(
        owner,
        f.strategy,
        { type: 'open', amount: raw(100, 9), targetLeverage: '2' },
        constraints
      )
    ).rejects.toMatchObject({
      code: 'NO_CONVERGENCE',
      message: 'Conversion quote time budget exhausted'
    })
    await started
    await vi.advanceTimersByTimeAsync(45_000)
    await rejected
  } finally {
    vi.useRealTimers()
  }
})

it.each([
  [18, 6],
  [6, 18],
  [18, 18]
])('supports the precision boundary for %i/%i native decimals', async (cd, dd) => {
  const f = fixture(cd, dd)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: raw(1, dd), targetLeverage: '2' },
    constraints
  )
  expect(Math.abs(Number(q.estimate.leverage) - 2)).toBeLessThanOrEqual(0.0002)
  await expect(build(f, q)).resolves.toBeDefined()
})

it.each([-1, 19, 255, 6.5])('rejects unsupported token precision %i', async (decimals) => {
  const f = fixture(6, 9)
  f.market.collateral.token.decimals = decimals
  await expect(
    f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: raw(100, 9), targetLeverage: '2' },
      constraints
    )
  ).rejects.toMatchObject({ code: 'MARKET_UNSUPPORTED' })
})

it('rejects old execution-plan units and changed token precision before PTB mutation', async () => {
  const f = fixture(9, 6)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: raw(100, 6), targetLeverage: '2' },
    constraints
  )
  await expect(
    build(f, { ...q, execution: { ...q.execution, version: 1 } } as typeof q)
  ).rejects.toMatchObject({ code: 'INVALID_QUOTE' })
  f.market.debt.token.decimals = 9
  const tx = new Transaction()
  const coins = q.estimate.inputs.map((input) => ({
    coinType: input.coinType,
    coin: tx.object('0x123')
  }))
  const before = JSON.stringify(tx.getData())
  await expect(f.engine.buildPTB(tx, q, { coins })).rejects.toMatchObject({ code: 'STALE_QUOTE' })
  expect(JSON.stringify(tx.getData())).toBe(before)
})

it.each([
  [6, 9],
  [9, 6],
  [8, 6]
])('decodes normalized chain balances as %i/%i native token atoms', async (cd, dd) => {
  const f = fixture(cd, dd, true)
  const reserve = (id: number) => ({
    id,
    oracle_id: id,
    coin_type: id === 1 ? collateralType : debtType,
    supply_cap: '0',
    borrow_cap: '0',
    supply_rate: '0',
    borrow_rate: '0',
    supply_index: '1000000000000000000000000000',
    borrow_index: '1000000000000000000000000000',
    total_supply: '0',
    total_borrow: '0',
    last_update_at: '0',
    ltv: '0',
    treasury_factor: '0',
    treasury_balance: '0',
    base_rate: '0',
    multiplier: '0',
    jump_rate_multiplier: '0',
    reserve_factor: '0',
    optimal_utilization: '0',
    liquidation_ratio: '0',
    liquidation_bonus: '0',
    liquidation_threshold: '0'
  })
  const value = (bytes: Uint8Array) => ({ returnValues: [{ bcs: bytes }] })
  const source = createNaviDataSource({
    client: {
      core: {
        simulateTransaction: async () => ({
          Transaction: { status: { success: true } },
          commandResults: [
            { returnValues: [] },
            value(
              bcs
                .vector(ReserveDataInfo)
                .serialize([reserve(1), reserve(2)])
                .toBytes()
            ),
            value(
              bcs
                .vector(UserStateInfo)
                .serialize([
                  { asset_id: 1, supply_balance: '100000000999', borrow_balance: '0' },
                  { asset_id: 2, supply_balance: '0', borrow_balance: '100000000001' }
                ])
                .toBytes()
            ),
            value(bcs.bool().serialize(false).toBytes())
          ]
        })
      }
    } as Parameters<typeof createNaviDataSource>[0]['client']
  })
  const p = await source.readPosition(
    {
      id: object,
      accountOwner: object,
      strategyId: f.strategy.id,
      registryKey: f.strategy.registryKey
    },
    f.strategy,
    f.market
  )
  expect(p).toMatchObject({
    protocolCollateralAmount: '100000000999',
    protocolDebtAmount: '100000000001'
  })
  expect(p.collateralAmount).toBe(
    new BN('100000000999')
      .shiftedBy(cd - 9)
      .integerValue(BN.ROUND_FLOOR)
      .toFixed(0)
  )
  expect(p.debtAmount).toBe(
    new BN('100000000001')
      .shiftedBy(dd - 9)
      .integerValue(BN.ROUND_CEIL)
      .toFixed(0)
  )
})

it('adds atomic registration only for a new Cap and binds the sender', async () => {
  const f = fixture(9, 9)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: raw(100, 9), targetLeverage: '2' },
    constraints
  )
  const { tx } = await build(f, q)
  expect(tx.getData().sender).toBe(owner)
  const functions = tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => c.MoveCall.function)
  expect(functions).toContain('register_mul_for_account_cap')
  expect(functions).not.toContain('set_account_name')
  expect(functions).not.toContain('set_account_description')
  f.setExisting(true)
  await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
  const repay = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'repay', amount: raw(1, 9) },
    constraints
  )
  const existing = await build(f, repay)
  expect(
    existing.tx
      .getData()
      .commands.some(
        (c) => c.$kind === 'MoveCall' && c.MoveCall.function === 'register_mul_for_account_cap'
      )
  ).toBe(false)
})

it('rejects changed Cap/deployment/strategy binding and wrong sender before mutation', async () => {
  const f = fixture(9, 9, true)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'repay', amount: raw(1, 9) },
    constraints
  )
  f.cap.id = '0x77'
  await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
  f.cap.id = object
  f.source.capRegistry = { ...MAINNET_CAP_REGISTRY, objectId: '0x78' }
  await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
  f.source.capRegistry = MAINNET_CAP_REGISTRY
  const changed = createMultiplyClient({
    dataSource: f.source,
    strategies: [{ ...f.strategy, market: 'different-market' }]
  })
  await expect(changed.buildPTB(new Transaction(), q, { coins: [] })).rejects.toMatchObject({
    code: 'STALE_QUOTE'
  })
  const tx = new Transaction()
  tx.setSender('0x77')
  const before = JSON.stringify(tx.getData())
  await expect(f.engine.buildPTB(tx, q, { coins: [] })).rejects.toMatchObject({
    code: 'INVALID_INPUTS'
  })
  expect(JSON.stringify(tx.getData())).toBe(before)
})

it('discovers all configured positions once per operation and rejects custom-source conflicts', async () => {
  const f = fixture(9, 9, true)
  const read = vi.spyOn(f.source, 'listAccountCaps')
  const engine = createMultiplyClient({
    dataSource: f.source,
    strategies: [
      f.strategy,
      {
        ...f.strategy,
        id: 'another',
        registryKey: { strategyNumericId: '101', strategyVersion: '1' }
      }
    ]
  })
  expect(await engine.getPosition(owner)).toHaveLength(1)
  expect(read).toHaveBeenCalledTimes(1)
  f.cap.strategyId = 'another'
  await expect(engine.getPosition(owner)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_CAP' })
})

// Phase 1: independent numeric expectations plus actual PTB coin-type inspection.
describe.each([
  [9, 6],
  [6, 9]
])('phase 1 principal=collateral %i/%i', (cd, dd) => {
  it.each(['collateral', 'debt'])('opens with %s at 1x and 2x', async (kind) => {
    for (const targetLeverage of ['1', '2']) {
      const f = fixture(cd, dd, false, true)
      const coin = kind === 'collateral' ? collateralType : debtType
      const amount = kind === 'collateral' ? raw(50, cd) : raw(100, dd)
      const q = await f.engine.quote(
        owner,
        f.strategy,
        { type: 'open', amount, inputCoinType: coin, targetLeverage },
        constraints
      )
      expect(q.estimate.inputs).toEqual([{ coinType: coin, amount }])
      expect(new BN(q.execution.collateralAfter).shiftedBy(-cd).toNumber()).toBeCloseTo(
        targetLeverage === '1' ? 50 : 100,
        5
      )
      expect(new BN(q.execution.debtAfter).shiftedBy(-dd).toNumber()).toBeCloseTo(
        targetLeverage === '1' ? 0 : 100,
        5
      )
      expect(q.execution.conversions.length).toBe(
        kind === 'collateral' && targetLeverage === '1' ? 0 : 1
      )
      const { tx } = await build(f, q)
      const swaps = tx
        .getData()
        .commands.filter((c) => c.$kind === 'MoveCall' && c.MoveCall.function === 'swap')
      expect(swaps.length).toBe(q.execution.conversions.length)
      for (const call of swaps)
        if (call.$kind === 'MoveCall')
          expect(call.MoveCall.typeArguments).toEqual([debtType, collateralType])
    }
  })
  it.each([
    'add_principal',
    'remove_principal',
    'repay',
    'add_collateral',
    'close',
    'up',
    'down',
    'debt_free'
  ])('manages %s and preserves output coin types', async (type) => {
    const f = fixture(cd, dd, true, true)
    const action: Action =
      type === 'up' || type === 'down' || type === 'debt_free'
        ? {
            type: 'set_leverage',
            targetLeverage: type === 'up' ? '2.5' : type === 'down' ? '1.5' : '1'
          }
        : type === 'close'
          ? { type: 'close' }
          : {
              type: type as 'add_principal' | 'remove_principal' | 'repay' | 'add_collateral',
              amount: raw(10, type === 'repay' ? dd : cd)
            }
    const q = await f.engine.quote(owner, f.strategy, action, constraints)
    if (type === 'remove_principal') {
      expect(q.estimate.minOutputs).toContainEqual({
        coinType: collateralType,
        amount: raw(10, cd)
      })
      expect(Number(q.estimate.leverage)).toBeCloseTo(2, 4)
    }
    if (type === 'close') {
      expect(q.execution.collateralAfter).toBe('0')
      expect(q.execution.debtAfter).toBe('0')
      expect(q.estimate.outputs[0].coinType).toBe(collateralType)
      expect(new BN(q.estimate.outputs[0].amount).shiftedBy(-cd).toNumber()).toBeCloseTo(50, 1)
      expect(BigInt(q.execution.conversions[0].input.amount)).toBeLessThan(
        BigInt(q.execution.withdrawAmount)
      )
    }
    const { tx } = await build(f, q)
    const swaps = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall' && c.MoveCall.function === 'swap')
    if (['close', 'remove_principal', 'down', 'debt_free'].includes(type))
      for (const call of swaps)
        if (call.$kind === 'MoveCall')
          expect(call.MoveCall.typeArguments).toEqual([collateralType, debtType])
  })
  it('closes an unlevered collateral position without conversion or flash loan', async () => {
    const f = fixture(cd, dd, true, true)
    f.setPosition({ collateralAmount: raw(100, cd), debtAmount: '0' })
    const q = await f.engine.quote(owner, f.strategy, { type: 'close' }, constraints)
    expect(q.execution.conversions).toEqual([])
    expect(q.execution.flashAmount).toBe('0')
    expect(q.estimate.minOutputs).toEqual([{ coinType: collateralType, amount: raw(100, cd) }])
    await build(f, q)
  })
})

it('rejects changed funding roles even with a recomputed checksum, before mutating a PTB', async () => {
  const { checksum } = await import('../src/utils')
  const f = fixture(9, 6, false, true)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', inputCoinType: collateralType, amount: raw(50, 9), targetLeverage: '2' },
    constraints
  )
  q.execution.conversions[0].source = 'wallet-and-flash'
  q.execution.checksum = ''
  q.execution.checksum = await checksum(q)
  const tx = new Transaction()
  const coin = tx.object('0x100')
  await expect(
    f.engine.buildPTB(tx, q, { coins: [{ coinType: collateralType, coin }] })
  ).rejects.toMatchObject({ code: 'INVALID_QUOTE' })
  expect(tx.getData().commands).toEqual([])
})
it('filters explicitly retired custom-source Caps only after duplicate identity checks', async () => {
  const f = fixture(9, 6, true)
  const retiredKey = { strategyNumericId: '1', strategyVersion: '1' }
  const retired = {
    ...f.cap,
    id: '0x' + 'c'.repeat(64),
    accountOwner: '0x' + 'd'.repeat(64),
    strategyId: 'retired',
    registryKey: retiredKey
  }
  f.source.listAccountCaps = async () => [retired, f.cap]
  const engine = createMultiplyClient({
    dataSource: f.source,
    strategies: [f.strategy],
    retiredRegistryKeys: [retiredKey]
  })
  expect((await engine.getPosition(owner)).map((p) => p.strategy.id)).toEqual([f.strategy.id])
  f.source.listAccountCaps = async () => [retired, { ...f.cap, id: retired.id }]
  await expect(engine.getPosition(owner)).rejects.toMatchObject({ code: 'DUPLICATE_ACCOUNT_CAP' })
})

describe.each([
  [9, 6],
  [6, 9]
])('bounded collateral-principal exits (%i/%i decimals)', (cd, dd) => {
  it.each(['close', 'one'])(
    'clears distressed positive-equity debt with %s, fees and slippage',
    async (kind) => {
      for (const [feeBps, slippage] of [
        [0, 0],
        [9, 20]
      ]) {
        const f = fixture(cd, dd, true, true)
        f.setPosition({ collateralAmount: raw(100, cd), debtAmount: raw(199, dd) })
        f.market.flash.feeBps = String(feeBps)
        const original = f.converter.quote
        f.converter.quote = vi.fn(async (r) => {
          expect(new BN(r.amountIn).lte(raw(100, cd))).toBe(true)
          const q = await original(r)
          q.minOutput.amount = (
            (BigInt(q.expectedOutput.amount) * BigInt(10000 - slippage)) /
            10000n
          ).toString()
          return q
        })
        const action: Action =
          kind === 'close' ? { type: 'close' } : { type: 'set_leverage', targetLeverage: '1' }
        const q = await f.engine.quote(owner, f.strategy, action, {
          minHealthFactor: '1.2',
          maxSlippageBps: slippage
        })
        expect(q.execution.debtAfter).toBe('0')
        expect(
          new BN(q.execution.conversions[0].minOutput.amount).gte(q.execution.flashRepayment)
        ).toBe(true)
        const equity = new BN(q.execution.collateralAfter).shiftedBy(-cd).times(2)
        const output = q.estimate.outputs.reduce(
          (sum, coin) =>
            sum.plus(
              new BN(coin.amount)
                .shiftedBy(coin.coinType === collateralType ? -cd : -dd)
                .times(coin.coinType === collateralType ? 2 : 1)
            ),
          new BN(0)
        )
        const fees = new BN(q.execution.flashRepayment)
          .minus(q.execution.flashAmount)
          .shiftedBy(-dd)
        expect(equity.plus(output).plus(fees).minus(1).abs().toNumber()).toBeLessThanOrEqual(
          2 / 10 ** Math.min(cd, dd)
        )
        if (kind === 'close')
          expect(
            q.estimate.outputs.some(
              (coin) => coin.coinType === collateralType && BigInt(coin.amount) > 0n
            )
          ).toBe(true)
        else expect(BigInt(q.execution.collateralAfter)).toBeGreaterThan(0n)
        await build(f, q)
      }
    }
  )
  it.each(['close', 'one'])(
    'rejects %s when all collateral cannot cover actual minimum output and fees',
    async (kind) => {
      const f = fixture(cd, dd, true, true)
      f.setPosition({ collateralAmount: raw(100, cd), debtAmount: raw(199, dd) })
      f.market.flash.feeBps = '100'
      const original = f.converter.quote
      f.converter.quote = vi.fn(original)
      const action: Action =
        kind === 'close' ? { type: 'close' } : { type: 'set_leverage', targetLeverage: '1' }
      await expect(
        f.engine.quote(owner, f.strategy, action, { minHealthFactor: '1.2', maxSlippageBps: 0 })
      ).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATION' })
      expect(f.converter.quote).toHaveBeenCalledWith(
        expect.objectContaining({ amountIn: raw(100, cd) })
      )
      expect(vi.mocked(f.converter.quote).mock.calls.length).toBeLessThanOrEqual(20)
    }
  )
})

describe('independent funding checks including nonzero fees', () => {
  it.each([0, 50, 100])('collateral principal with %i bps slippage', async (slippage) => {
    for (const [cd, dd] of [
      [9, 6],
      [6, 9]
    ])
      for (const kind of ['open-c', 'open-d', 'close', 'withdraw', 'down', 'one']) {
        const f = fixture(cd, dd, !kind.startsWith('open'), true)
        f.market.flash.feeBps = '9'
        f.source.readBorrowFeeBps = async () => '30'
        const original = f.converter.quote
        f.converter.quote = async (r) => {
          const q = await original(r)
          q.minOutput.amount = (
            (BigInt(q.expectedOutput.amount) * BigInt(10000 - slippage)) /
            10000n
          ).toString()
          return q
        }
        const a: Action = kind.startsWith('open')
          ? {
              type: 'open',
              amount: kind === 'open-c' ? raw(50, cd) : raw(100, dd),
              inputCoinType: kind === 'open-c' ? collateralType : debtType,
              targetLeverage: '2'
            }
          : kind === 'close'
            ? { type: 'close' }
            : kind === 'withdraw'
              ? { type: 'remove_principal', amount: raw(10, cd) }
              : { type: 'set_leverage', targetLeverage: kind === 'one' ? '1' : '1.5' }
        const q = await f.engine.quote(owner, f.strategy, a, {
          minHealthFactor: '1.2',
          maxSlippageBps: slippage,
          maxLeverage: '3'
        })
        await build(f, q)
        const e = q.execution
        const initial = kind.startsWith('open') ? new BN(0) : new BN(100)
        const walletIn = q.estimate.inputs.reduce(
          (sum, p) =>
            sum.plus(
              new BN(p.amount)
                .shiftedBy(p.coinType === collateralType ? -cd : -dd)
                .times(p.coinType === collateralType ? 2 : 1)
            ),
          new BN(0)
        )
        const equity = new BN(e.collateralAfter)
          .shiftedBy(-cd)
          .times(2)
          .minus(new BN(e.debtAfter).shiftedBy(-dd))
        const output = q.estimate.outputs.reduce(
          (sum, p) =>
            sum.plus(
              new BN(p.amount)
                .shiftedBy(p.coinType === collateralType ? -cd : -dd)
                .times(p.coinType === collateralType ? 2 : 1)
            ),
          new BN(0)
        )
        const costs = new BN(e.flashRepayment).minus(e.flashAmount).plus(e.borrowFee).shiftedBy(-dd)
        expect(
          equity.plus(output).plus(costs).minus(initial).minus(walletIn).abs().toNumber(),
          `${cd}/${dd} ${kind}`
        ).toBeLessThanOrEqual(2 / 10 ** Math.min(cd, dd))
      }
  })
})

describe('sub-atom protocol positions', () => {
  const position = (collateral: string, debt = '0'): PositionAmounts => ({
    collateralAmount: lendingToRaw(collateral, 6),
    debtAmount: lendingToRaw(debt, 6, true),
    protocolCollateralAmount: collateral,
    protocolDebtAmount: debt
  })
  it.each([false, true])(
    'clears 999 protocol units with no principal output, explicit minimum %s',
    async (explicit) => {
      const f = fixture(6, 6, true, false, true)
      f.setPosition(position('999'))
      const convert = vi.spyOn(f.converter, 'quote')
      const q = await f.engine.quote(owner, f.strategy, { type: 'close' }, constraints)
      expect(q.estimate.outputs).toEqual([])
      if (explicit) {
        q.estimate.minOutputs = [{ coinType: debtType, amount: '0' }]
        q.execution.checksum = ''
        q.execution.checksum = await checksum(q)
      }
      const { tx, built } = await build(f, q)
      expect(convert).not.toHaveBeenCalled()
      expect(built.coins.map((c) => c.coinType)).toEqual([collateralType])
      const calls = tx
        .getData()
        .commands.flatMap((c) => (c.$kind === 'MoveCall' ? [c.MoveCall.function] : []))
      expect(calls.filter((c) => c === 'user_collateral_balance')).toHaveLength(2)
      expect(calls).toContain('user_loan_balance')
      expect(calls).toContain('withdraw_with_account_cap_v2')
      for (const next of [position('1000'), position('0'), position('999', '1')]) {
        f.setPosition(next)
        await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
      }
    }
  )
  it.each([
    'positive minimum',
    'unexpected token',
    'two zero entries',
    'zero output',
    'non-canonical minimum',
    'ordinary withdrawal'
  ])('rejects %s before changing the PTB', async (kind) => {
    const f = fixture(6, 6, true, false, true)
    f.setPosition(position('999'))
    const q = await f.engine.quote(owner, f.strategy, { type: 'close' }, constraints)
    const zero = { coinType: debtType, amount: '0' }
    if (kind === 'positive minimum') q.estimate.minOutputs = [{ ...zero, amount: '1' }]
    if (kind === 'unexpected token') q.estimate.minOutputs = [{ ...zero, coinType: collateralType }]
    if (kind === 'two zero entries') q.estimate.minOutputs = [zero, zero]
    if (kind === 'zero output') q.estimate.outputs = [zero]
    if (kind === 'non-canonical minimum') q.estimate.minOutputs = [{ ...zero, amount: '00' }]
    if (kind === 'ordinary withdrawal') q.action = { type: 'remove_principal', amount: '1' }
    q.execution.checksum = ''
    q.execution.checksum = await checksum(q)
    const tx = new Transaction()
    await expect(f.engine.buildPTB(tx, q, { coins: [] })).rejects.toMatchObject({
      code: 'INVALID_QUOTE'
    })
    expect(tx.getData().commands).toEqual([])
  })
  const open: Action = {
    type: 'open',
    amount: '1000',
    targetLeverage: '1',
    inputCoinType: collateralType
  }
  it('keeps sub-atom deposits visible and prevents unsupported cleanup or reopening', async () => {
    const f = fixture(6, 6, true)
    f.setPosition(position('1'))
    expect(await f.engine.getPosition(owner)).toMatchObject([
      { protocolCollateralAmount: '1', collateralAmount: '0' }
    ])
    await expect(f.engine.quote(owner, f.strategy, open, constraints)).rejects.toMatchObject({
      code: 'POSITION_EXISTS'
    })
    await expect(
      f.engine.quote(owner, f.strategy, { type: 'close' }, constraints)
    ).rejects.toMatchObject({ code: 'POSITION_UNSUPPORTED' })
  })
  it('rejects an empty-cap quote when one protocol unit appears', async () => {
    const f = fixture(6, 6, true)
    f.setPosition(position('0'))
    const q = await f.engine.quote(owner, f.strategy, open, constraints)
    for (const next of [position('1'), position('0', '1')]) {
      f.setPosition(next)
      await expect(build(f, q)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
    }
  })
  it('repays a protocol debt of one unit using one native atom', async () => {
    const f = fixture(6, 6, true)
    f.setPosition(position('0', '1'))
    const q = await f.engine.quote(owner, f.strategy, { type: 'repay', amount: '1' }, constraints)
    expect(q.estimate.inputs).toEqual([{ coinType: debtType, amount: '1' }])
    expect(q.execution.debtAfter).toBe('0')
    expect((await build(f, q)).built.coins.map((c) => c.coinType)).toContain(debtType)
  })
})

describe('configured E-Mode initialization and risk', () => {
  it.each([0, 2, undefined])('initializes mode %s atomically in both builders', async (emodeId) => {
    const f = fixture(9, 6, false, false, false, emodeId)
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: raw(100, 6), targetLeverage: '2' },
      constraints
    )
    const { tx } = await build(f, q)
    const sim = new Transaction()
    await f.engine.buildPTBForSimulation(
      sim,
      q,
      q.estimate.inputs.map((input, i) => ({
        coinType: input.coinType,
        coin: sim.object(`0x${i + 100}`)
      }))
    )
    expect(sim.getData()).toEqual(tx.getData())
    const calls = tx.getData().commands.flatMap((c) => (c.$kind === 'MoveCall' ? [c.MoveCall] : []))
    const init = calls.filter((c) =>
      ['create_account', 'enter_emode_with_account_cap', 'register_mul_for_account_cap'].includes(
        c.function
      )
    )
    expect(init.map((c) => c.function)).toEqual([
      'create_account',
      ...(emodeId !== undefined ? ['enter_emode_with_account_cap'] : []),
      'register_mul_for_account_cap'
    ])
    expect(calls.some((c) => c.module === 'registry' || c.function === 'is_in_emode')).toBe(false)
    if (emodeId !== undefined) {
      const enter = init[1]
      expect(enter.arguments[2]).toEqual(
        calls.find((c) => c.function === 'id_address')!.arguments[0]
      )
      const arg = enter.arguments[1]
      expect(arg.$kind).toBe('Input')
      const input = tx.getData().inputs[(arg as { Input: number }).Input]
      expect(input.$kind).toBe('Pure')
      if (input.$kind === 'Pure')
        expect(bcs.u64().parse(Buffer.from(input.Pure.bytes, 'base64'))).toBe(String(emodeId))
    }
  })
  it.each([false, true])(
    'reuses initialized Caps without repeat enter (empty: %s)',
    async (empty) => {
      const f = fixture(9, 6, true, false, false, 0)
      if (empty) f.setPosition({ collateralAmount: '0', debtAmount: '0' })
      const q = await f.engine.quote(
        owner,
        f.strategy,
        empty
          ? { type: 'open', amount: raw(100, 6), targetLeverage: '2' }
          : { type: 'repay', amount: raw(1, 6) },
        constraints
      )
      const { tx } = await build(f, q)
      expect(
        tx
          .getData()
          .commands.some(
            (c) =>
              c.$kind === 'MoveCall' &&
              ['enter_emode_with_account_cap', 'create_account', 'is_in_emode'].includes(
                c.MoveCall.function
              )
          )
      ).toBe(false)
    }
  )
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '0'])(
    'rejects illegal mode ID %s',
    (id) => {
      const f = fixture(9, 6)
      expect(() =>
        createMultiplyClient({ strategies: [{ ...f.strategy, emodeId: id as number }] })
      ).toThrow('E-Mode ID')
    }
  )
  it('binds modes to the registered strategy and market snapshot', async () => {
    const f = fixture(9, 6, false, false, false, 0)
    const action: Action = { type: 'open', amount: raw(100, 6), targetLeverage: '2' }
    await expect(
      f.engine.quote(owner, { ...f.strategy, emodeId: 2 }, action, constraints)
    ).rejects.toThrow('Registry binding')
    f.market.emode = undefined
    await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toThrow(
      'configured E-Mode'
    )
  })
  it('uses E-Mode LT and the actual borrow weight above the ordinary leverage limit', async () => {
    const f = fixture(9, 6, false, false, false, 0)
    f.market.ltv = '0.9'
    f.market.liquidationThreshold = '0.93'
    f.market.borrowWeight = '1.01'
    const c = { minHealthFactor: '1.05', maxSlippageBps: 0 }
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: raw(100, 6), targetLeverage: '7' },
      c
    )
    expect(Number(q.estimate.healthFactor)).toBeCloseTo((7 * 0.93) / (6 * 1.01), 6)
    await expect(build(f, q)).resolves.toBeDefined()
    await expect(
      f.engine.quote(
        owner,
        f.strategy,
        { type: 'open', amount: raw(100, 6), targetLeverage: '9' },
        c
      )
    ).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATION' })
  })
  it('rejects paused exposure at quote and live build while preserving repayments', async () => {
    const f = fixture(9, 6, false, false, false, 0)
    const action: Action = { type: 'open', amount: raw(100, 6), targetLeverage: '1' }
    const q = await f.engine.quote(owner, f.strategy, action, constraints)
    f.market.emode!.active = false
    await expect(build(f, q)).rejects.toThrow('paused')
    await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toThrow('paused')
    f.setExisting(true)
    const repay = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'repay', amount: raw(1, 6) },
      constraints
    )
    await expect(build(f, repay)).resolves.toBeDefined()
    await expect(
      f.engine.quote(
        owner,
        f.strategy,
        { type: 'set_leverage', targetLeverage: '2.5' },
        constraints
      )
    ).rejects.toThrow('paused')
  })
})

it.each(['add_collateral', 'set_leverage', 'close'] as const)(
  'preserves paused E-Mode risk-reducing %s',
  async (type) => {
    const f = fixture(6, 6, true, false, false, 2)
    f.market.emode!.active = false
    const action: Action =
      type === 'add_collateral'
        ? { type, amount: raw(1, 6) }
        : type === 'set_leverage'
          ? { type, targetLeverage: '1.5' }
          : { type }
    const quote = await f.engine.quote(owner, f.strategy, action, constraints)
    expect(quote.execution.borrowAmount).toBe('0')
    await expect(build(f, quote)).resolves.toBeDefined()
  }
)
it('preserves a six-decimal E-Mode dust exit without re-entering mode or funding a nonexistent output', async () => {
  const f = fixture(6, 6, true, false, true, 2)
  f.setPosition({
    collateralAmount: '0',
    debtAmount: '0',
    protocolCollateralAmount: '999',
    protocolDebtAmount: '0'
  })
  const quote = await f.engine.quote(owner, f.strategy, { type: 'close' }, constraints)
  expect(quote.estimate.inputs).toEqual([])
  const { tx } = await build(f, quote)
  expect(
    tx
      .getData()
      .commands.some(
        (c) => c.$kind === 'MoveCall' && c.MoveCall.function === 'enter_emode_with_account_cap'
      )
  ).toBe(false)
  f.setPosition({
    collateralAmount: '1',
    debtAmount: '0',
    protocolCollateralAmount: '1000',
    protocolDebtAmount: '0'
  })
  await expect(build(f, quote)).rejects.toMatchObject({ code: 'STALE_QUOTE' })
})

// LQ-05..LQ-10 (e2e/FAILURE-MATRIX.md, second #127 review): on a main-market strategy the borrow uses borrow-cap
// headroom (`availableBorrow`, lending 9-decimal) and flash + borrow + fee use pool cash (`debt.balance`, raw in the
// coin's decimals). Fixture from the review: headroom 80, cash 300; 100 at 1.5x → flash 50, borrow 50.
describe.each([
  [9, 6],
  [6, 9],
  [8, 6],
  [9, 9]
])('main-market same-reserve capacity (%i/%i decimals)', (cd, dd) => {
  const open: Action = { type: 'open', amount: raw(100, dd), targetLeverage: '1.5' }
  const main = (existing = false) => fixture(cd, dd, existing, false, false, undefined, 'main')
  const headroom = (f: ReturnType<typeof main>, rawAmount: BN.Value) => {
    f.market.debt.availableBorrow = new BN(rawAmount).shiftedBy(9 - dd).toFixed()
  }
  const near = (value: string, whole: number) =>
    expect(new BN(value).minus(raw(whole, dd)).abs().lte(2)).toBe(true)
  const refused = async (f: ReturnType<typeof main>, action: Action, q: unknown) => {
    await expect(f.engine.quote(owner, f.strategy, action, constraints)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED'
    })
    await expect(build(f, q as Parameters<typeof build>[1])).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED'
    })
  }

  it('LQ-05: cash for flash + borrow, headroom only for the borrow → quoted and built', async () => {
    const f = main()
    f.market.debt.availableBorrow = raw(80, 9)
    f.market.debt.balance = raw(300, dd)
    const q = await f.engine.quote(owner, f.strategy, open, constraints)
    near(q.execution.flashAmount, 50)
    near(q.execution.borrowAmount, 50)
    await expect(build(f, q)).resolves.toBeDefined()
  })

  it('LQ-06/LQ-07: cash is compared raw with flash + borrow + fee, at the exact boundary', async () => {
    const f = main()
    const q = await f.engine.quote(owner, f.strategy, open, constraints)
    const e = q.execution
    const need = new BN(e.flashAmount).plus(e.borrowAmount).plus(e.borrowFee)
    f.market.debt.balance = need.toFixed(0)
    await expect(f.engine.quote(owner, f.strategy, open, constraints)).resolves.toBeDefined()
    await expect(build(f, q)).resolves.toBeDefined()
    f.market.debt.balance = need.minus(1).toFixed(0)
    await refused(f, open, q)
  })

  it('LQ-08: the borrow alone is still bounded by headroom, at the exact boundary', async () => {
    const f = main()
    const q = await f.engine.quote(owner, f.strategy, open, constraints)
    const borrow = new BN(q.execution.borrowAmount).plus(q.execution.borrowFee)
    headroom(f, borrow)
    await expect(build(f, q)).resolves.toBeDefined()
    headroom(f, borrow.minus(1))
    await refused(f, open, q)
  })

  it.each([undefined, '1.5', '-1', ''])('LQ-09: cash %s fails closed', async (cash) => {
    const f = main()
    if (cash === undefined) delete (f.market.debt as { balance?: string }).balance
    else f.market.debt.balance = cash
    await expect(f.engine.quote(owner, f.strategy, open, constraints)).rejects.toMatchObject({
      code: 'READ_FAILED'
    })
  })

  it('LQ-10: a flash-only exit needs cash for the flash, not headroom', async () => {
    const f = main(true)
    const down: Action = { type: 'set_leverage', targetLeverage: '1.5' }
    f.market.debt.availableBorrow = '0'
    const q = await f.engine.quote(owner, f.strategy, down, constraints)
    expect(q.execution.borrowAmount).toBe('0')
    expect(new BN(q.execution.flashAmount).gt(0)).toBe(true)
    await expect(build(f, q)).resolves.toBeDefined()
    f.market.debt.balance = new BN(q.execution.flashAmount).minus(1).toFixed(0)
    await refused(f, down, q)
  })
})

// ST-20..ST-23 (e2e/FAILURE-MATRIX.md): a quote is bound to the NAVI env it was made for.
describe('stored quotes and the NAVI env', () => {
  const reseal = async (q: Awaited<ReturnType<ReturnType<typeof fixture>['engine']['quote']>>) => {
    q.execution.checksum = ''
    q.execution.checksum = await checksum(q)
    return q
  }
  const simulate = (f: ReturnType<typeof fixture>, q: Parameters<typeof build>[1]) => {
    const tx = new Transaction()
    const coins = q.estimate.inputs.map((input, i) => ({
      coinType: input.coinType,
      coin: tx.object(`0x${i + 100}`)
    }))
    const before = tx.getData().commands.length
    return { tx, before, run: () => f.engine.buildPTBForSimulation(tx, q, coins) }
  }

  it.each([false, true])(
    'ST-20/ST-21: a quote for another env is refused before any command (existing Cap: %s)',
    async (existing) => {
      const f = fixture(9, 6, existing)
      const action: Action = existing
        ? { type: 'repay', amount: raw(1, 6) }
        : { type: 'open', amount: raw(100, 6), targetLeverage: '2' }
      const q = await f.engine.quote(owner, f.strategy, action, constraints)
      expect((q.execution as { env?: string }).env).toBe('prod')
      ;(q.execution as { env?: string }).env = 'dev'
      await reseal(q)
      for (const entry of ['simulation', 'live'] as const) {
        const s = simulate(f, q)
        const run =
          entry === 'simulation'
            ? s.run()
            : f.engine.buildPTB(s.tx, q, {
                coins: q.estimate.inputs.map((input, i) => ({
                  coinType: input.coinType,
                  coin: s.tx.object(`0x${i + 200}`)
                }))
              })
        await expect(run).rejects.toMatchObject({ code: 'INVALID_QUOTE' })
        expect(s.tx.getData().commands.length).toBe(s.before)
      }
    }
  )

  it('ST-23: a quote without an env (made before the binding) asks for a fresh quote', async () => {
    const f = fixture(9, 6, true)
    const q = await f.engine.quote(
      owner,
      f.strategy,
      { type: 'repay', amount: raw(1, 6) },
      constraints
    )
    delete (q.execution as { env?: string }).env
    await reseal(q)
    const s = simulate(f, q)
    await expect(s.run()).rejects.toMatchObject({ code: 'INVALID_QUOTE' })
    expect(s.tx.getData().commands.length).toBe(s.before)
  })
})
