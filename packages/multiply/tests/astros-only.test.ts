import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@naviprotocol/astros-aggregator-sdk', () => ({
  getQuote: vi.fn(),
  buildSwapPTBFromQuote: vi.fn()
}))
import { getQuote, buildSwapPTBFromQuote } from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { createMultiplyClient } from '../src/client'
import { MAINNET_CAP_REGISTRY } from '../src/cap-registry'
import { SUI, VSUI, HASUI } from '../src/strategies'
import { BN, coinType, checksum } from '../src/utils'
import type { DataSource, MarketSnapshot, MultiplySuiClient, Strategy } from '../src/types'
const owner = '0x' + 'a'.repeat(64),
  object = '0x' + 'b'.repeat(64)
const USDC = coinType('0x33::usdc::USDC'),
  USD = coinType('0x44::usd::USD')
function fixture(collateral: string, debt: string, existing = false) {
  const strategy: Strategy = {
    id: 'test-astros',
    market: 'main',
    registryKey: { strategyNumericId: '100', strategyVersion: '1' },
    principalCoinType: debt,
    collateralCoinType: collateral,
    debtCoinType: debt
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
      token: { decimals: 9 },
      leftSupply: '1000000'
    },
    debt: {
      id: 2,
      contract: { pool: object },
      token: { decimals: 9 },
      availableBorrow: '1000000000000000',
      balance: '1000000000000000'
    },
    collateralPrice: '1',
    debtPrice: '1',
    ltv: '0.8',
    liquidationThreshold: '0.9',
    borrowWeight: '1',
    flash: { config, poolId: object, min: '0', max: '1000000000000000', feeBps: '0' },
    observedAt: Date.now()
  } as MarketSnapshot
  const cap = {
    id: object,
    accountOwner: object,
    strategyId: strategy.id,
    registryKey: strategy.registryKey
  }
  const source: DataSource = {
    env: 'prod',
    capRegistry: MAINNET_CAP_REGISTRY,
    listAccountCaps: async () => (existing ? [cap] : []),
    readMarket: async () => market,
    readPosition: async () => ({ collateralAmount: '100000000000', debtAmount: '50000000000' }),
    readBorrowFeeBps: async () => '0',
    prepareOracle: async () => {
      throw new Error('Unexpected oracle update')
    }
  }
  const getObject = vi.fn(async () => {
    throw new Error('Do not inspect native cash/pause/minimum')
  })
  const simulate = vi.fn(async () => {
    throw new Error('Optional rate getter paused or unavailable')
  })
  const client = {
    core: { getObject, simulateTransaction: simulate }
  } as unknown as MultiplySuiClient
  const engine = createMultiplyClient({
    client,
    dataSource: source,
    strategies: [strategy],
    prepareOracleForSimulation: false
  })
  return { strategy, engine, getObject, simulate }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getQuote).mockImplementation(
    async (from, to, amount) =>
      ({
        from,
        target: to,
        amount_in: Number(amount),
        amount_out: Number(amount),
        routes: [
          {
            amount_in: Number(amount),
            amount_out: Number(amount),
            path: [
              {
                provider: 'vSui',
                from,
                target: to,
                amount_in: Number(amount),
                amount_out: Number(amount),
                a2b: true
              }
            ]
          }
        ]
      }) as never
  )
  vi.mocked(buildSwapPTBFromQuote).mockImplementation(
    async (_recipient, tx, _min, coin) =>
      tx.moveCall({ target: `${object}::fixture::astros`, arguments: [coin] }) as never
  )
})
it.each([
  [VSUI, SUI],
  [HASUI, SUI],
  [USD, USDC]
])('default execution uses Astros for %s, even when native getters fail', async (c, d) => {
  const f = fixture(c, d)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: '100000000', targetLeverage: '2' },
    { minHealthFactor: '1.1', maxSlippageBps: 50 }
  )
  expect(q.execution.conversions[0].converterId).toBe('astros')
  expect(getQuote).toHaveBeenCalledTimes(1)
  expect(vi.mocked(getQuote).mock.calls[0][4]).toMatchObject({ byAmountIn: true })
  expect(f.getObject).not.toHaveBeenCalled()
  const tx = new Transaction()
  await f.engine.buildPTBForSimulation(tx, q, [{ coinType: d, coin: tx.object('0x123') }])
  expect(getQuote).toHaveBeenCalledTimes(1)
  expect(buildSwapPTBFromQuote).toHaveBeenCalledTimes(1)
  expect(vi.mocked(buildSwapPTBFromQuote).mock.calls[0][4]).toEqual(
    (q.execution.conversions[0].data as { route: unknown }).route
  )
})
it('rejects a correctly checksummed native plan in the default execution registry', async () => {
  const f = fixture(VSUI, SUI)
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'open', amount: '1000000000', targetLeverage: '2' },
    { minHealthFactor: '1.1', maxSlippageBps: 0 }
  )
  q.execution.conversions[0].converterId = 'volo'
  q.execution.checksum = ''
  q.execution.checksum = await checksum(q)
  const tx = new Transaction()
  await expect(
    f.engine.buildPTBForSimulation(tx, q, [{ coinType: SUI, coin: tx.object('0x123') }])
  ).rejects.toThrow()
  expect(buildSwapPTBFromQuote).not.toHaveBeenCalled()
})
it('default exit fallback keeps querying Astros and never native', async () => {
  const f = fixture(HASUI, SUI, true)
  vi.mocked(getQuote).mockImplementation(async (from, to, amount) => {
    const output = new BN(amount).times('.999').integerValue(BN.ROUND_FLOOR).toNumber()
    return {
      from,
      target: to,
      amount_in: Number(amount),
      amount_out: output,
      routes: [
        {
          amount_in: Number(amount),
          amount_out: output,
          path: [{ provider: 'cetus', from, target: to }]
        }
      ]
    } as never
  })
  const q = await f.engine.quote(
    owner,
    f.strategy,
    { type: 'set_leverage', targetLeverage: '1.5' },
    { minHealthFactor: '1.1', maxSlippageBps: 50 }
  )
  expect(vi.mocked(getQuote).mock.calls.length).toBeGreaterThan(1)
  expect(q.execution.conversions[0].converterId).toBe('astros')
  expect(new BN(q.estimate.leverage!).minus('1.5').abs().lte('.00015')).toBe(true)
  expect(f.getObject).not.toHaveBeenCalled()
})
it('rejects wrong-pair upstream data before using it as a solver price', async () => {
  const f = fixture(VSUI, SUI)
  vi.mocked(getQuote).mockResolvedValueOnce({
    from: HASUI,
    target: SUI,
    amount_in: 2000000000,
    amount_out: 2000000000,
    routes: [{ amount_in: 2000000000, amount_out: 2000000000, path: [] }]
  } as never)
  await expect(
    f.engine.quote(
      owner,
      f.strategy,
      { type: 'open', amount: '1000000000', targetLeverage: '2' },
      { minHealthFactor: '1.1', maxSlippageBps: 0 }
    )
  ).rejects.toMatchObject({ code: 'INVALID_CONVERSION' })
  expect(getQuote).toHaveBeenCalledTimes(1)
})
