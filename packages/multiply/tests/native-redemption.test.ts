import { describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { createRedemptionSnapshotReader, quoteRedemptionSnapshot } from '../src/native-redemption'
import type { MultiplySuiClient, RedemptionSnapshot } from '../src/types'
import { address } from '../src/utils'
const SUI = '0x2::sui::SUI',
  LST = '0x3::lst::LST'
const snapshot = (provider: 'volo' | 'haedal' = 'volo'): RedemptionSnapshot => ({
  converterId: provider,
  coinIn: LST,
  coinOut: SUI,
  suiSupply: '1100000000000000',
  lstSupply: '1000000000000000',
  feeRate: '3',
  feeDenominator: provider === 'volo' ? '10000' : '10000000',
  feeRounding: provider === 'volo' ? 'ceil' : 'floor',
  availableSui: '1100000000000000',
  minOutput: '1000000000',
  minOutputBasis: provider === 'volo' ? 'net' : 'gross',
  epoch: '1',
  observedAt: Date.now(),
  expiresAt: Date.now() + 5000
})
const req = (amount: string) => ({ coinIn: LST, coinOut: SUI, amountIn: amount, slippageBps: 50 })
describe('native redemption integer arithmetic', () => {
  it.each(['1000000000', '1000000001', '100000000000000'])(
    'matches deployed fee and slippage order for %s',
    (amount) => {
      for (const provider of ['volo', 'haedal'] as const) {
        const s = snapshot(provider),
          q = quoteRedemptionSnapshot(s, req(amount)),
          gross = (BigInt(amount) * 11n) / 10n
        const den = BigInt(s.feeDenominator),
          fee = (gross * 3n + (provider === 'volo' ? den - 1n : 0n)) / den
        expect(q.expectedOutput.amount).toBe(String(gross - fee))
        expect(q.minOutput.amount).toBe(String(((gross - fee) * 9950n) / 10000n))
      }
    }
  )
  it('uses gross for Haedal capacity and minimum, not net', () => {
    const s = {
      ...snapshot('haedal'),
      suiSupply: '1000000000000000',
      availableSui: '1000000000',
      feeRate: '2000'
    }
    expect(quoteRedemptionSnapshot(s, req('1000000000')).expectedOutput.amount).toBe('999800000')
    expect(() => quoteRedemptionSnapshot(s, req('999999999'))).toThrow(/minimum/)
    expect(() => quoteRedemptionSnapshot(s, req('1000000001'))).toThrow(/cash/)
  })
  it('retains Volo SDK net minimum and checks cash before fees', () => {
    const s = {
      ...snapshot(),
      suiSupply: '1000000000000000',
      feeRate: '0',
      availableSui: '1000000001'
    }
    expect(quoteRedemptionSnapshot(s, req('1000000000')).expectedOutput.amount).toBe('1000000000')
    expect(() => quoteRedemptionSnapshot(s, req('999999999'))).toThrow(/minimum/)
    expect(() => quoteRedemptionSnapshot({ ...s, feeRate: '3' }, req('1000000001'))).toThrow(
      /minimum/
    )
  })
  it.each([
    { suiSupply: '0' },
    { feeRate: '10000' },
    { lstSupply: '18446744073709551616' },
    { expiresAt: 0 },
    { availableSui: '1' },
    { minOutputBasis: 'unknown' }
  ])('rejects invalid or unavailable snapshot %j', (patch) => {
    expect(() =>
      quoteRedemptionSnapshot({ ...snapshot(), ...patch } as RedemptionSnapshot, req('1000000000'))
    ).toThrow()
  })
})
function reader(kind: 'volo' | 'haedal') {
  const state: Record<string, unknown> =
    kind === 'volo'
      ? { manage: { version: '2', paused: false }, validator_pool: { sui_pool: '5000000000' } }
      : {
          version: '5',
          pause_unstake: false,
          total_staked: '10000000000',
          total_rewards: '2000000000',
          total_protocol_fees: '500000000',
          uncollected_protocol_fees: '500000000',
          total_unstaked: '1000000000',
          stsui_supply: '9000000000',
          config: { service_fee: '2000' },
          sui_vault: { cache_pool: '5000000000' }
        }
  const system = vi.fn(async () => ({ systemState: { epoch: '100' } }))
  const value = (n: string) => ({ returnValues: [{ bcs: bcs.u64().serialize(n).toBytes() }] })
  const simulate = vi.fn(async ({ transaction }: { transaction: Transaction }) => {
    expect(transaction.getData().commands.map((c) => c.MoveCall?.function)).toEqual([
      'refresh',
      'total_sui_supply',
      'total_lst_supply',
      'fee_config',
      'unstake_fee_bps',
      'validator_pool',
      'sui_pool',
      'value',
      'epoch'
    ])
    return {
      Transaction: {
        status: { success: true },
        effects: {
          changedObjects: [{ inputState: 'Exists', inputVersion: '10', objectId: address('0x10') }],
          unchangedConsensusObjects: [
            { kind: 'ReadOnlyRoot', version: '11', objectId: address('0x11') }
          ]
        }
      },
      commandResults: [
        value('0'),
        value('10000000000'),
        value('9000000000'),
        value('0'),
        value('3'),
        value('0'),
        value('0'),
        value('5000000000'),
        value('100')
      ]
    }
  })
  const client = {
    core: {
      getCurrentSystemState: system,
      getObject: vi.fn(async () => ({
        object: { objectId: address('0x10'), version: '10', json: state }
      })),
      simulateTransaction: simulate
    }
  } as unknown as MultiplySuiClient
  const read = createRedemptionSnapshotReader(client, {
    converterId: kind,
    packageId: '0x1',
    pool: '0x10',
    metadata: '0x11',
    coinIn: LST,
    coinOut: SUI
  })
  return { read: () => read({ coinIn: LST, coinOut: SUI }), system, simulate, state }
}
describe('coherent native redemption reads', () => {
  it.each(['volo', 'haedal'] as const)(
    'captures %s versions, cash, fee and supply coherently',
    async (kind) => {
      const f = reader(kind),
        s = await f.read()
      expect(s).toMatchObject({
        suiSupply: '10000000000',
        lstSupply: '9000000000',
        availableSui: '5000000000',
        epoch: '100',
        source: { objectVersions: { [address('0x10')]: '10' } }
      })
      expect(f.simulate).toHaveBeenCalledTimes(kind === 'volo' ? 1 : 0)
    }
  )
  it.each(['volo', 'haedal'] as const)('rejects epoch crossing for %s', async (kind) => {
    const f = reader(kind)
    f.system
      .mockResolvedValueOnce({ systemState: { epoch: '100' } })
      .mockResolvedValue({ systemState: { epoch: '101' } })
    await expect(f.read()).rejects.toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' })
  })
  it('rejects a slow snapshot at the TTL boundary', async () => {
    vi.useFakeTimers()
    try {
      const f = reader('haedal')
      f.system.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 5000)
        return { systemState: { epoch: '100' } }
      })
      await expect(f.read()).rejects.toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' })
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not hide unknown state versions or overflow', async () => {
    const f = reader('haedal')
    f.state.version = '6'
    await expect(f.read()).rejects.toMatchObject({ code: 'READ_FAILED' })
    f.state.version = '5'
    f.state.total_staked = '18446744073709551615'
    await expect(f.read()).rejects.toThrow()
  })
  it('rejects paused redemptions without network simulations', async () => {
    const f = reader('haedal')
    f.state.pause_unstake = true
    await expect(f.read()).rejects.toMatchObject({ code: 'CONVERTER_UNAVAILABLE' })
    expect(f.simulate).not.toHaveBeenCalled()
  })
})

it('falls back before refresh when Volo cash cannot meet even the minimum', async () => {
  const f = reader('volo')
  f.state.validator_pool = { sui_pool: '999999999' }
  await expect(f.read()).rejects.toMatchObject({ code: 'CONVERTER_UNAVAILABLE' })
  expect(f.simulate).not.toHaveBeenCalled()
})
