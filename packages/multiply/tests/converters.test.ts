import { getQuote } from '@naviprotocol/astros-aggregator-sdk'
vi.mock('@naviprotocol/astros-aggregator-sdk', () => ({
  getQuote: vi.fn(),
  buildSwapPTBFromQuote: vi.fn()
}))
import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it, vi } from 'vitest'
import { astrosConverter, haedalConverter, voloConverter } from '../src/converters'
import { chooseConversion } from '../src/planner'
import { HASUI, VSUI, SUI } from '../src/strategies'
import { MultiplyError } from '../src/utils'
import type { Converter, MultiplySuiClient } from '../src/types'
const req = { coinIn: HASUI, coinOut: SUI, amountIn: '1000000000', slippageBps: 50 }
function fixture(gross: string, pause = false, liquidity = '100000000000') {
  const client = {
    core: {
      getObject: vi.fn(async () => ({
        object: {
          json: {
            pause_stake: pause,
            pause_unstake: pause,
            config: { deposit_fee: '2000', service_fee: '2000' },
            sui_vault: { cache_pool: liquidity }
          }
        }
      })),
      simulateTransaction: vi.fn(async () => ({
        Transaction: { status: { success: true } },
        commandResults: [{ returnValues: [{ bcs: bcs.u64().serialize(gross).toBytes() }] }]
      }))
    }
  } as unknown as MultiplySuiClient
  return haedalConverter({ client })
}
describe('verified Haedal gross minimum and fallback classification', () => {
  it.each(['999999999', '1000000000', '1000000001'])(
    'checks %s gross SUI BEFORE charging fees',
    async (gross) => {
      const converter = fixture(gross)
      if (BigInt(gross) < 1000000000n)
        await expect(converter.quote(req)).rejects.toMatchObject({
          code: 'CONVERSION_AMOUNT_TOO_SMALL'
        })
      else {
        const q = await converter.quote(req)
        expect(q.expectedOutput.amount).toBe(
          (BigInt(gross) - (BigInt(gross) * 2000n) / 10000000n).toString()
        )
        expect(q.fees).toEqual([
          { coinType: SUI, amount: '200000', feeKind: 'redemption', includedInExpectedOutput: true }
        ])
      }
    }
  )
  it.each(['minimum', 'pause', 'liquidity'])(
    'falls back for expected %s unavailability without relaxing slippage',
    async (reason) => {
      const primary =
        reason === 'minimum'
          ? fixture('999999999')
          : fixture('1000000000', reason === 'pause', reason === 'liquidity' ? '0' : '100000000000')
      const fallback: Converter = {
        id: 'dex',
        supports: () => true,
        quote: vi.fn(async (r) => ({
          converterId: 'dex',
          input: { coinType: r.coinIn, amount: r.amountIn },
          expectedOutput: { coinType: r.coinOut, amount: '1000000000' },
          minOutput: { coinType: r.coinOut, amount: '995000000' },
          expiresAt: Date.now() + 60000,
          data: null
        })),
        buildPTB: vi.fn()
      }
      expect((await chooseConversion(req, [primary], fallback)).converterId).toBe('dex')
      expect(fallback.quote).toHaveBeenCalledWith(req)
    }
  )
  it.each(['INVALID_CONVERSION', 'INVALID_ARGUMENT', 'READ_FAILED'])(
    'does not hide %s behind fallback',
    async (code) => {
      const primary = fixture('1000000000')
      primary.quote = async () => {
        throw new MultiplyError(code, 'invalid')
      }
      const fallback = fixture('1000000000')
      fallback.quote = vi.fn()
      await expect(chooseConversion(req, [primary], fallback)).rejects.toMatchObject({ code })
      expect(fallback.quote).not.toHaveBeenCalled()
    }
  )
})

function fallbackFixture(): Converter {
  return {
    id: 'dex',
    supports: () => true,
    buildPTB: vi.fn(),
    quote: vi.fn(async (r) => ({
      converterId: 'dex',
      input: { coinType: r.coinIn, amount: r.amountIn },
      expectedOutput: { coinType: r.coinOut, amount: '1000000000' },
      minOutput: { coinType: r.coinOut, amount: '995000000' },
      expiresAt: Date.now() + 60000,
      data: null
    }))
  }
}
const validHaedalState = () => ({
  pause_stake: false,
  pause_unstake: false,
  config: { deposit_fee: '2000', service_fee: '2000' },
  sui_vault: { cache_pool: '100000000000' }
})
function nativeFixture(kind: string, json: unknown) {
  const client = {
    core: {
      getObject: vi.fn(async () => ({ object: { json } })),
      simulateTransaction: vi.fn(async () => ({
        Transaction: { status: { success: true } },
        commandResults: [{ returnValues: [{ bcs: bcs.u64().serialize('1000000000').toBytes() }] }]
      }))
    }
  } as unknown as MultiplySuiClient
  return kind === 'volo' ? voloConverter({ client }) : haedalConverter({ client })
}
describe.each(['volo', 'haedal'])('%s real adapter error classification', (kind) => {
  const request = { ...req, coinIn: kind === 'volo' ? VSUI : HASUI }
  it.each(
    [
      undefined,
      null,
      {},
      [],
      { manage: {} },
      { manage: { paused: 'false' }, pause_unstake: 'false' }
    ].map((state) => [state])
  )('rejects malformed state %j before fallback', async (state) => {
    const fallback = fallbackFixture()
    await expect(
      chooseConversion(request, [nativeFixture(kind, state)], fallback)
    ).rejects.toMatchObject({ code: 'READ_FAILED' })
    expect(fallback.quote).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'handles a valid paused=%s without relaxing minimum output',
    async (paused) => {
      const state =
        kind === 'volo' ? { manage: { paused } } : { ...validHaedalState(), pause_unstake: paused }
      const fallback = fallbackFixture()
      const q = await chooseConversion(request, [nativeFixture(kind, state)], fallback)
      expect(q.converterId).toBe(paused ? 'dex' : kind)
      expect(BigInt(q.minOutput.amount) >= (BigInt(q.expectedOutput.amount) * 9950n) / 10000n).toBe(
        true
      )
      expect(vi.mocked(fallback.quote).mock.calls.length).toBe(paused ? 1 : 0)
    }
  )
})

it.each([
  { config: undefined },
  { config: { service_fee: 'bad' } },
  { config: { service_fee: '10000000' } },
  { sui_vault: undefined },
  { sui_vault: { cache_pool: '-1' } }
])(
  'does not treat invalid Haedal fee/liquidity as expected unavailability: %j',
  async (override) => {
    const fallback = fallbackFixture()
    await expect(
      chooseConversion(
        req,
        [nativeFixture('haedal', { ...validHaedalState(), ...override })],
        fallback
      )
    ).rejects.toMatchObject({ code: 'READ_FAILED' })
    expect(fallback.quote).not.toHaveBeenCalled()
  }
)

describe('actual Astros adapter empty-route classification', () => {
  const route = () => ({
    from: req.coinIn,
    target: req.coinOut,
    amount_in: req.amountIn,
    amount_out: '1000000000',
    routes: [{ amount_in: req.amountIn, amount_out: '1000000000', path: [] }],
    dexList: []
  })
  it.each([
    { amount_out: '0', routes: [] },
    { amount_out: 0, routes: [] },
    { routes: [] },
    { amount_out: '0' }
  ])('returns NO_CONVERSION_ROUTE for a valid unavailable response %j', async (override) => {
    vi.mocked(getQuote).mockResolvedValueOnce({ ...route(), ...override } as never)
    await expect(
      chooseConversion(req, [fixture('999999999')], astrosConverter())
    ).rejects.toMatchObject({ code: 'NO_CONVERSION_ROUTE' })
  })
  it.each([
    { amount_out: [0], routes: [] },
    { amount_in: [req.amountIn], routes: [] },
    { amount_out: '-1', routes: [] },
    { amount_out: 'bad', routes: [] },
    { routes: null },
    { routes: undefined },
    { amount_in: '1', amount_out: '0', routes: [] },
    { routes: [{ amount_in: 'bad', amount_out: '1' }] }
  ])('preserves malformed-response errors %j', async (override) => {
    vi.mocked(getQuote).mockResolvedValueOnce({ ...route(), ...override } as never)
    await expect(
      chooseConversion(req, [fixture('999999999')], astrosConverter())
    ).rejects.toMatchObject({ code: 'INVALID_CONVERSION' })
  })
  it('preserves a valid route and its slippage minimum', async () => {
    vi.mocked(getQuote).mockResolvedValueOnce(route() as never)
    expect(await chooseConversion(req, [fixture('999999999')], astrosConverter())).toMatchObject({
      converterId: 'astros',
      expectedOutput: { amount: '1000000000' },
      minOutput: { amount: '995000000' }
    })
  })
  it('keeps client input and transport failures separate from no-route errors', async () => {
    vi.mocked(getQuote).mockClear()
    await expect(astrosConverter().quote({ ...req, amountIn: '0' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(getQuote).not.toHaveBeenCalled()
    const error = new Error('network unavailable')
    vi.mocked(getQuote).mockRejectedValueOnce(error)
    await expect(chooseConversion(req, [fixture('999999999')], astrosConverter())).rejects.toBe(
      error
    )
  })
})

it('classifies an Astros minimum rounded below one atom as a small conversion, not invalid input', async () => {
  vi.mocked(getQuote).mockResolvedValueOnce({
    from: req.coinIn,
    target: req.coinOut,
    amount_in: req.amountIn,
    amount_out: '1',
    routes: [{ amount_in: req.amountIn, amount_out: '1', path: [] }],
    dexList: []
  } as never)
  await expect(
    chooseConversion(req, [fixture('999999999')], astrosConverter())
  ).rejects.toMatchObject({ code: 'CONVERSION_AMOUNT_TOO_SMALL' })
})
it.each(['deposit_fee', 'pause_stake'])(
  'rejects malformed Haedal staking %s before fallback',
  async (field) => {
    const state = validHaedalState()
    const malformed =
      field === 'deposit_fee'
        ? { ...state, config: { ...state.config, deposit_fee: 'bad' } }
        : { ...state, pause_stake: 'false' }
    const fallback = fallbackFixture()
    await expect(
      chooseConversion(
        { ...req, coinIn: SUI, coinOut: HASUI },
        [nativeFixture('haedal', malformed)],
        fallback
      )
    ).rejects.toMatchObject({ code: 'READ_FAILED' })
    expect(fallback.quote).not.toHaveBeenCalled()
  }
)
it.each([true, false])('handles valid Haedal staking pause=%s', async (paused) => {
  const fallback = fallbackFixture()
  const q = await chooseConversion(
    { ...req, coinIn: SUI, coinOut: HASUI },
    [nativeFixture('haedal', { ...validHaedalState(), pause_stake: paused })],
    fallback
  )
  expect(q.converterId).toBe(paused ? 'dex' : 'haedal')
})
it('does not let a paused Haedal pool hide malformed configuration', async () => {
  const fallback = fallbackFixture()
  await expect(
    chooseConversion(
      req,
      [nativeFixture('haedal', { ...validHaedalState(), pause_unstake: true, config: null })],
      fallback
    )
  ).rejects.toMatchObject({ code: 'READ_FAILED' })
  expect(fallback.quote).not.toHaveBeenCalled()
})
