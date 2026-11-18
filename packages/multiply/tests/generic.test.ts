import { MAINNET_CAP_REGISTRY } from '../src/cap-registry'
import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { ReserveDataInfo, UserStateInfo } from '@naviprotocol/lending'
import type { Action, Converter, DataSource, MarketSnapshot, Strategy } from '../src/types'
import { createMultiplyClient } from '../src/client'
import { createNaviDataSource } from '../src/data-source'
import { amountCushion, lendingToRaw } from '../src/amounts'
import { coinType, BN } from '../src/utils'

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
  collateralPrincipal = false
) {
  const strategy: Strategy = {
    id: `external-pair-${collateralDecimals}-${debtDecimals}`,
    market: 'external-market',
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
      availableBorrow: raw(1000000, 9)
    },
    collateralPrice: '2',
    debtPrice: '1',
    ltv: '0.8',
    liquidationThreshold: '0.9',
    borrowWeight: '1',
    flash: { config, poolId: object, min: '0', max: raw(1000000, debtDecimals), feeBps: '0' },
    observedAt: Date.now()
  } as MarketSnapshot
  let position = {
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

it('rejects unsupported principal and E-Mode capabilities without hardcoding pair IDs', () => {
  const f = fixture(9, 6)
  expect(() =>
    createMultiplyClient({
      strategies: [{ ...f.strategy, principalCoinType: '0x33::fixture::THIRD' }]
    })
  ).toThrow('Principal must equal collateral or debt')
  expect(() => createMultiplyClient({ strategies: [{ ...f.strategy, emodeId: 1 }] })).toThrow(
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
