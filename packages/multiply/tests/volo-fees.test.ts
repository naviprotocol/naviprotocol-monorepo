import { getQuote } from '@naviprotocol/astros-aggregator-sdk'
vi.mock('@naviprotocol/astros-aggregator-sdk', () => ({
  getQuote: vi.fn(),
  buildSwapPTBFromQuote: vi.fn()
}))
import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it, vi } from 'vitest'
import { astrosConverter, voloConverter } from '../src/converters'
import { SUI, VSUI } from '../src/strategies'
import type { MultiplySuiClient } from '../src/types'

const req = { coinIn: VSUI, coinOut: SUI, amountIn: '1124465677', slippageBps: 50 }
function clientFixture(gross = '1203202845', feeBps: string | null = '3', direct = false) {
  const u64 = (value: string) => ({ returnValues: [{ bcs: bcs.u64().serialize(value).toBytes() }] })
  const client = {
    core: {
      getObject: vi.fn(async () => ({ object: { json: { manage: { paused: false } } } })),
      simulateTransaction: vi.fn(async () => ({
        Transaction: { status: { success: true } },
        commandResults: [
          ...(direct ? [u64('1202841882')] : []),
          u64(gross),
          { returnValues: [] },
          feeBps === null ? { returnValues: [] } : u64(feeBps)
        ]
      }))
    }
  } as unknown as MultiplySuiClient
  return client
}
const fee = (amount: string) => [
  { provider: 'volo', coinType: SUI, amount, feeKind: 'redemption', includedInExpectedOutput: true }
]
function route() {
  // ENG-5577: Astros hop amount_out and fee_rate are not authoritative fee data.
  return {
    from: VSUI,
    target: SUI,
    amount_in: '934588763',
    amount_out: '999730388',
    dexList: [],
    routes: [
      {
        amount_in: '934588763',
        amount_out: '999730390',
        path: [
          {
            provider: 'vSui',
            from: VSUI,
            target: SUI,
            a2b: false,
            amount_in: '934588763',
            amount_out: '999730390',
            fee_rate: 0
          }
        ]
      }
    ]
  }
}
describe('Volo provider fees use deployed SUI-denominated ceil arithmetic', () => {
  it('matches ENG-5582 gross, total user fee and net output, without a second fee deduction', async () => {
    const client = clientFixture(undefined, undefined, true)
    const quote = await voloConverter({ client }).quote(req)
    expect(quote.fees).toEqual(fee('360961'))
    expect(quote.expectedOutput.amount).toBe('1202841884')
    expect(quote.minOutput.amount).toBe('1196827674')
    expect(client.core.simulateTransaction).toHaveBeenCalledTimes(1)
  })
  it('reports a verified zero fee and does not use slippage as a fee', async () => {
    const quote = await voloConverter({ client: clientFixture('1203202845', '0', true) }).quote(req)
    expect(quote.fees).toEqual(fee('0'))
    expect(quote.expectedOutput.amount).toBe('1203202845')
    expect(quote.minOutput.amount).not.toBe(quote.expectedOutput.amount)
  })
  it.each([null, '10001'])(
    'omits unavailable or invalid fee data (%s) without inventing zero',
    async (feeBps) => {
      const quote = await voloConverter({
        client: clientFixture('1203202845', feeBps, true)
      }).quote(req)
      expect(quote.fees).toBeUndefined()
      expect(quote.expectedOutput.amount).toBe('1202841882')
    }
  )
  it('does not label SUI staking as redemption', async () => {
    const quote = await voloConverter({ client: clientFixture(undefined, undefined, true) }).quote({
      ...req,
      coinIn: SUI,
      coinOut: VSUI
    })
    expect(quote.fees).toBeUndefined()
  })
  it('retries the existing output getter without optional fee getters if they are unavailable', async () => {
    const client = clientFixture(undefined, undefined, true)
    vi.mocked(client.core.simulateTransaction)
      .mockRejectedValueOnce(new Error('fee getter unavailable'))
      .mockResolvedValueOnce({
        Transaction: { status: { success: true } },
        commandResults: [{ returnValues: [{ bcs: bcs.u64().serialize('1202841882').toBytes() }] }]
      } as never)
    const quote = await voloConverter({ client }).quote(req)
    expect(quote.fees).toBeUndefined()
    expect(quote.expectedOutput.amount).toBe('1202841882')
    expect(client.core.simulateTransaction).toHaveBeenCalledTimes(2)
  })
  it('still rejects if the original output getter also fails', async () => {
    const client = clientFixture(undefined, undefined, true)
    vi.mocked(client.core.simulateTransaction).mockRejectedValue(new Error('RPC unavailable'))
    await expect(voloConverter({ client }).quote(req)).rejects.toThrow('RPC unavailable')
  })
  it('matches ENG-5577 on an Astros single-hop Volo route despite fee_rate=0', async () => {
    vi.mocked(getQuote).mockResolvedValueOnce(route() as never)
    const quote = await astrosConverter({ client: clientFixture('1000030398') }).quote({
      ...req,
      amountIn: '934588763'
    })
    expect(quote.fees).toEqual(fee('300010'))
    expect(quote.expectedOutput.amount).toBe('999730388')
    expect(quote.minOutput.amount).toBe('994731736')
  })
  it('does not change a valid Astros quote when the optional chain fee read fails', async () => {
    vi.mocked(getQuote).mockResolvedValueOnce(route() as never)
    const client = clientFixture()
    vi.mocked(client.core.simulateTransaction).mockRejectedValueOnce(new Error('RPC unavailable'))
    const quote = await astrosConverter({ client }).quote({ ...req, amountIn: '934588763' })
    expect(quote.fees).toBeUndefined()
    expect(quote.expectedOutput.amount).toBe('999730388')
  })
  it('bounds an optional Astros fee read to 1500ms without losing the valid route', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getQuote).mockResolvedValueOnce(route() as never)
      const client = clientFixture()
      vi.mocked(client.core.simulateTransaction).mockReturnValueOnce(new Promise(() => {}))
      const pending = astrosConverter({ client }).quote({ ...req, amountIn: '934588763' })
      await vi.advanceTimersByTimeAsync(1500)
      const quote = await pending
      expect(quote.fees).toBeUndefined()
      expect(quote.expectedOutput.amount).toBe('999730388')
    } finally {
      vi.useRealTimers()
    }
  })
  it.each(['cetus', 'split', 'multihop', 'mismatched-input', 'mismatched-pair'])(
    'does not infer Volo fees for %s routes',
    async (kind) => {
      const r = route()
      if (kind === 'cetus') r.routes[0].path[0].provider = 'cetus'
      if (kind === 'split') r.routes.push(r.routes[0])
      if (kind === 'multihop') r.routes[0].path.push(r.routes[0].path[0])
      if (kind === 'mismatched-input') r.routes[0].amount_in = '1'
      if (kind === 'mismatched-pair') r.routes[0].path[0].from = SUI
      vi.mocked(getQuote).mockResolvedValueOnce(r as never)
      const client = clientFixture()
      expect(
        (await astrosConverter({ client }).quote({ ...req, amountIn: '934588763' })).fees
      ).toBeUndefined()
      expect(client.core.simulateTransaction).not.toHaveBeenCalled()
    }
  )
})
