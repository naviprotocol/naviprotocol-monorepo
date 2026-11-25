import { describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { createStakingSnapshotReader, quoteStakingSnapshot } from '../src/native-staking'
import { haedalConverter } from '../src/converters'
import { SUI, VSUI, HASUI } from '../src/strategies'
import type { MultiplySuiClient, StakingSnapshot } from '../src/types'

const snapshot = (extra: Partial<StakingSnapshot> = {}): StakingSnapshot => ({
  converterId: 'volo',
  coinIn: SUI,
  coinOut: VSUI,
  suiSupply: '10',
  lstSupply: '9',
  feeRate: '3',
  feeDenominator: '10000',
  feeRounding: 'ceil',
  minInput: '1000000000',
  epoch: '10',
  observedAt: Date.now(),
  expiresAt: Date.now() + 5000,
  ...extra
})
const req = (amountIn: string, coinOut = VSUI, slippageBps = 50) => ({
  coinIn: SUI,
  coinOut,
  amountIn,
  slippageBps
})
const value = (amount: string) => ({
  returnValues: [{ bcs: bcs.u64().serialize(amount).toBytes() }]
})
function fixture(kind: 'volo' | 'haedal') {
  let epoch = '10',
    fee = '3'
  const state: Record<string, any> = {
    manage: { version: '2', paused: false },
    version: '5',
    pause_stake: false,
    total_staked: '10000000000',
    total_rewards: '2000000000',
    total_protocol_fees: '500000000',
    uncollected_protocol_fees: '500000000',
    total_unstaked: '1000000000',
    stsui_supply: '9000000000',
    config: { deposit_fee: '9999999', service_fee: '2000' }
  }
  const getCurrentSystemState = vi.fn(async () => ({ systemState: { epoch } }))
  const getObject = vi.fn(async () => ({ object: { json: state } }))
  const simulateTransaction = vi.fn(async ({ transaction }: { transaction: Transaction }) => {
    const calls = transaction.getData().commands.map((c) => c.MoveCall?.function)
    expect(calls).toEqual([
      'refresh',
      'total_sui_supply',
      'total_lst_supply',
      'fee_config',
      'stake_fee_bps',
      'epoch'
    ])
    return {
      Transaction: { status: { success: true } },
      commandResults: [
        { returnValues: [{ bcs: bcs.bool().serialize(true).toBytes() }] },
        value('10000000000'),
        value('9000000000'),
        { returnValues: [] },
        value(fee),
        value(epoch)
      ]
    }
  })
  const client = {
    core: { getCurrentSystemState, getObject, simulateTransaction }
  } as unknown as MultiplySuiClient
  const coinOut = kind === 'volo' ? VSUI : HASUI
  const read = createStakingSnapshotReader(client, {
    converterId: kind,
    packageId: '0x1',
    pool: '0x2',
    metadata: '0x3',
    coinIn: SUI,
    coinOut
  })
  return {
    read: () => read({ coinIn: SUI, coinOut }),
    readPair: read,
    client,
    state,
    getObject,
    simulateTransaction,
    getCurrentSystemState,
    setEpoch: (e: string) => {
      epoch = e
    },
    setFee: (f: string) => {
      fee = f
    },
    coinOut
  }
}

describe('pinned native staking integer arithmetic', () => {
  it.each(['1000000000', '1000000001', '100000000000', '100000000000000'])(
    'matches ceil deposit fees then floor minting for %s atoms',
    (amount) => {
      const q = quoteStakingSnapshot(snapshot(), req(amount))
      const a = BigInt(amount),
        fee = (a * 3n + 9999n) / 10000n,
        output = ((a - fee) * 9n) / 10n
      expect(q.expectedOutput.amount).toBe(output.toString())
      expect(q.minOutput.amount).toBe(((output * 9950n) / 10000n).toString())
      expect(q.fees![0].amount).toBe(fee.toString())
      expect(q.expiresAt - Date.now()).toBeGreaterThan(110000) // cache TTL does not shrink quote lifetime
    }
  )
  it.each(['999999999', '1000000000', '1000000001'])('keeps SDK minimum boundary %s', (amount) => {
    if (BigInt(amount) < 1000000000n)
      expect(() => quoteStakingSnapshot(snapshot(), req(amount))).toThrow(/minimum/)
    else
      expect(quoteStakingSnapshot(snapshot(), req(amount, VSUI, 0)).expectedOutput.amount).toBe(
        quoteStakingSnapshot(snapshot(), req(amount, VSUI, 0)).minOutput.amount
      )
  })
  it.each([
    ['0', '0'],
    ['0', '7'],
    ['7', '0']
  ])('matches native bootstrapping with totals %s/%s', (suiSupply, lstSupply) => {
    expect(
      quoteStakingSnapshot(snapshot({ suiSupply, lstSupply, feeRate: '0' }), req('1000000000'))
        .expectedOutput.amount
    ).toBe('1000000000')
  })
  it('checks integer bounds and rejects malformed/expired snapshots', () => {
    expect(() => quoteStakingSnapshot(snapshot({ feeRate: '10000' }), req('1000000000'))).toThrow(
      /fee/
    )
    expect(() =>
      quoteStakingSnapshot(snapshot({ expiresAt: Date.now() - 1 }), req('1000000000'))
    ).toThrow(/expired/)
    expect(() => quoteStakingSnapshot(snapshot(), req('18446744073709551616'))).toThrow(/u64/)
    expect(() =>
      quoteStakingSnapshot(
        snapshot({ suiSupply: '1', lstSupply: '18446744073709551615', feeRate: '0' }),
        req('1000000000')
      )
    ).toThrow(/u64/)
    expect(() => quoteStakingSnapshot(snapshot(), req('1000000000', HASUI))).toThrow(/pair/)
  })
})

describe.each(['volo', 'haedal'] as const)('%s complete snapshot lifecycle', (kind) => {
  it('deduplicates snapshots, retains complete integers, and checks epoch on every reuse', async () => {
    const f = fixture(kind)
    const [a, b] = await Promise.all([f.read(), f.read()])
    expect(f.getObject).toHaveBeenCalledTimes(1)
    expect(a!.suiSupply).toBe('10000000000')
    expect(b!.lstSupply).toBe('9000000000')
    expect(a!.feeRate).toBe(kind === 'volo' ? '3' : '0')
    a!.suiSupply = '1'
    expect((await f.read())!.suiSupply).toBe('10000000000')
    expect(f.getCurrentSystemState).toHaveBeenCalledTimes(3)
    expect(f.simulateTransaction).toHaveBeenCalledTimes(kind === 'volo' ? 1 : 0)
  })
  it('invalidates within TTL at epoch change and at TTL within the same epoch', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(kind)
      await f.read()
      f.setEpoch('11')
      expect((await f.read())!.epoch).toBe('11')
      expect(f.getObject).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(5000)
      await f.read()
      expect(f.getObject).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not let a late pre-epoch request overwrite a new snapshot', async () => {
    const f = fixture(kind),
      original = f.getObject.getMockImplementation()!
    let release!: () => void
    f.getObject.mockImplementationOnce(async () => {
      const data = await original()
      return new Promise((resolve) => {
        release = () => resolve(data)
      })
    })
    const first = f.read()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(release).toBeDefined()
    f.setEpoch('11')
    await f.read()
    release()
    if (kind === 'haedal')
      await expect(first).rejects.toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' })
    else await first // Volo refresh observes the new simulation epoch.
    expect((await f.read())!.epoch).toBe('11')
    expect(f.getObject).toHaveBeenCalledTimes(2)
  })
  it('rejects slow reads beyond TTL and retries failed or expired pending work', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(kind),
        original = f.getObject.getMockImplementation()!
      let release!: () => void
      f.getObject.mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            release = async () => resolve(await original())
          })
      )
      const failed = expect(f.read()).rejects.toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' })
      await vi.advanceTimersByTimeAsync(5001)
      expect((await f.read())!.suiSupply).toBe('10000000000')
      release()
      await failed
      expect((await f.read())!.suiSupply).toBe('10000000000')
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps pause/version checks and never caches failures', async () => {
    const f = fixture(kind)
    if (kind === 'volo') f.state.manage.paused = true
    else f.state.pause_stake = true
    await expect(f.read()).rejects.toMatchObject({ code: 'CONVERTER_UNAVAILABLE' })
    if (kind === 'volo') f.state.manage.paused = false
    else f.state.pause_stake = false
    await expect(f.read()).resolves.toBeDefined()
    f.setEpoch('11')
    if (kind === 'volo') f.state.manage.version = '3'
    else f.state.version = '6'
    await expect(f.read()).rejects.toMatchObject({ code: 'READ_FAILED' })
  })
  it('does not fetch snapshots for redemption or another pair', async () => {
    const f = fixture(kind)
    expect(await f.readPair({ coinIn: f.coinOut, coinOut: SUI })).toBeUndefined()
    expect(f.getCurrentSystemState).not.toHaveBeenCalled()
  })
})

it('Volo refresh and totals share a simulation epoch even if epoch changes during the read', async () => {
  const f = fixture('volo'),
    original = f.getObject.getMockImplementation()!
  f.getObject.mockImplementationOnce(async () => {
    f.setEpoch('11')
    return original()
  })
  expect((await f.read())!.epoch).toBe('11')
  await f.read()
  expect(f.getObject).toHaveBeenCalledTimes(1)
})
it('Haedal ignores configured deposit_fee, matching the pinned stake entrypoint and remote fallback', async () => {
  const f = fixture('haedal')
  const snapshot = (await f.read())!
  const q = quoteStakingSnapshot(snapshot, req('1000000001', HASUI, 0))
  expect(q.fees![0].amount).toBe('0')
  expect(q.expectedOutput.amount).toBe('900000000')
  f.simulateTransaction.mockImplementationOnce(async ({ transaction }) => {
    const pure = transaction.getData().inputs.find((i) => i.$kind === 'Pure')!.Pure!.bytes
    expect(bcs.u64().parse(Uint8Array.from(atob(pure), (c) => c.charCodeAt(0)))).toBe('1000000001')
    return { Transaction: { status: { success: true } }, commandResults: [value('900000000')] }
  })
  const fallback = await haedalConverter({ client: f.client }).quote(req('1000000001', HASUI, 0))
  expect(fallback.expectedOutput).toEqual(q.expectedOutput)
  expect(fallback.fees![0].amount).toBe('0')
})
it('Haedal refuses underflow and overflow in the deployed get_total_sui operation order', async () => {
  const f = fixture('haedal')
  f.state.total_staked = '18446744073709551615'
  await expect(f.read()).rejects.toMatchObject({ code: 'READ_FAILED' })
  f.state.total_staked = '0'
  f.state.total_rewards = '0'
  await expect(f.read()).rejects.toMatchObject({ code: 'READ_FAILED' })
})
