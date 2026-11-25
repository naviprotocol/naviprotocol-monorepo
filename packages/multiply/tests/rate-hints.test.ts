import { describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { createChainRateHintReader } from '../src/rate-hints'
import { SUI, VSUI, HASUI } from '../src/strategies'
import type { MultiplySuiClient } from '../src/types'
const value = (n: string) => ({ returnValues: [{ bcs: bcs.u64().serialize(n).toBytes() }] })
function fixture(volo: boolean) {
  const simulateTransaction = vi.fn(async () => ({
    Transaction: { status: { success: true } },
    commandResults: volo
      ? [{ returnValues: [] }, value('1070000000000'), value('1000000000000'), value('1000')]
      : [value('900000000000'), value('1000')]
  }))
  const getObject = vi.fn(() => {
    throw new Error('native cash/pause/minimum MUST NOT be read')
  })
  const client = { core: { simulateTransaction, getObject } } as unknown as MultiplySuiClient
  return { simulateTransaction, getObject, reader: createChainRateHintReader(client) }
}
describe('independent mainnet chain rate hints', () => {
  it.each([VSUI, HASUI])(
    'reads both directions of %s without cash/fee/minimum gates',
    async (lst) => {
      const f = fixture(lst === VSUI)
      const up = await f.reader({ coinIn: SUI, coinOut: lst })
      const down = await f.reader({ coinIn: lst, coinOut: SUI })
      expect(up?.input.amount).toBe(down?.output.amount)
      expect(up?.output.amount).toBe(down?.input.amount)
      expect(f.getObject).not.toHaveBeenCalled()
      expect(f.simulateTransaction).toHaveBeenCalledTimes(2)
      expect(down!.expiresAt).toBeGreaterThan(Date.now())
    }
  )
  it('does not reuse prior epoch data or an old response', async () => {
    const f = fixture(true)
    expect((await f.reader({ coinIn: SUI, coinOut: VSUI }))?.input.amount).toBe('1070000000000')
    f.simulateTransaction.mockResolvedValueOnce({
      Transaction: { status: { success: true } },
      commandResults: [
        { returnValues: [] },
        value('1080000000000'),
        value('1000000000000'),
        value('1001')
      ]
    })
    expect((await f.reader({ coinIn: SUI, coinOut: VSUI }))?.input.amount).toBe('1080000000000')
  })
  it.each(['paused', 'unknown-deployment', 'RPC unavailable'])(
    'ignores optional getter failure: %s',
    async (error) => {
      const f = fixture(true)
      f.simulateTransaction.mockRejectedValueOnce(new Error(error))
      expect(await f.reader({ coinIn: SUI, coinOut: VSUI })).toBeUndefined()
    }
  )
  it('does not turn zero supply into a 1:1 rate', async () => {
    const f = fixture(true)
    f.simulateTransaction.mockResolvedValueOnce({
      Transaction: { status: { success: true } },
      commandResults: [{ returnValues: [] }, value('0'), value('1000000000000'), value('1001')]
    })
    expect(await f.reader({ coinIn: SUI, coinOut: VSUI })).toBeUndefined()
  })
  it('does not read unsupported pairs and rejects invalid caller types', async () => {
    const f = fixture(false)
    expect(await f.reader({ coinIn: VSUI, coinOut: HASUI })).toBeUndefined()
    expect(f.simulateTransaction).not.toHaveBeenCalled()
    await expect(f.reader({ coinIn: 'bad', coinOut: HASUI })).rejects.toThrow()
  })
  it('bounds optional rate reads and ignores late results', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(true)
      f.simulateTransaction.mockReturnValueOnce(new Promise(() => {}))
      const pending = f.reader({ coinIn: SUI, coinOut: VSUI })
      await vi.advanceTimersByTimeAsync(2000)
      expect(await pending).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
