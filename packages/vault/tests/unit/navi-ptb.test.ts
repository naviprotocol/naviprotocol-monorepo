import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vault } from '../../src/types'

vi.mock('@naviprotocol/lending', () => ({
  DEFAULT_CACHE_TIME: 1000,
  getPools: vi.fn(async () => []),
  getConfig: vi.fn(async () => ({}) as never),
  getPriceFeeds: vi.fn(async () => []),
  filterPriceFeeds: vi.fn(() => []),
  updateOraclePricesPTB: vi.fn(async () => {})
}))
vi.mock('../../src/protocols/navi/vault', () => ({
  getVaultInfo: vi.fn(async () => ({
    total_assets: '1000',
    total_shares: '2000',
    markets: { contents: [] }
  })),
  getVaultDefaultPool: vi.fn(async () => ({
    market: 'main',
    contract: { pool: '0x0000000000000000000000000000000000000000000000000000000000009001' }
  })),
  getVaultRewardRules: vi.fn(async () => [])
}))
vi.mock('../../src/protocols/navi/receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/protocols/navi/receipt')>()
  return { ...actual, getVaultReceipts: vi.fn() }
})
vi.mock('../../src/protocols/navi/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/protocols/navi/utils')>()
  return {
    ...actual,
    getMarketConfig: vi.fn(async () => ({
      storage: normalizeSuiAddress('0x570'),
      priceOracle: normalizeSuiAddress('0x0ac1'),
      incentiveV2: normalizeSuiAddress('0x11c2'),
      incentiveV3: normalizeSuiAddress('0x11c3')
    }))
  }
})

import { withdrawPTB } from '../../src/protocols/navi/ptb'
import { getVaultReceipts } from '../../src/protocols/navi/receipt'

const OWNER = normalizeSuiAddress('0xabcd')
const PACKAGE = normalizeSuiAddress('0x11a1')

const vault: Vault = {
  id: normalizeSuiAddress('0x9e5f'),
  source: 'navi',
  protocol: 'navi',
  name: 'SUI VAULT',
  riskLevel: null,
  status: 'open',
  apy: { avg7d: null, avg30d: null, instant: null, target: null },
  assets: { baseCoin: { coinType: '0x2::sui::SUI', decimals: 9, symbol: 'SUI' } },
  totalStaked: null,
  totalStakedUsd: null,
  totalShares: null,
  exchangeRate: null,
  coinPrice: null,
  minInvestment: null,
  stakeCapAmount: null,
  lockup: null,
  navi: { package: PACKAGE }
}

function mockReceipts(receipts: { id: string; shares: bigint }[]) {
  vi.mocked(getVaultReceipts).mockResolvedValue(
    receipts.map((receipt) => ({
      id: normalizeSuiAddress(receipt.id),
      shares: receipt.shares
    })) as never
  )
}

function withdrawCalls(tx: Transaction) {
  return tx
    .getData()
    .commands.filter((command) => command.$kind === 'MoveCall')
    .map((command) => command.MoveCall as { function: string; arguments: unknown[] })
    .filter((call) => call.function === 'withdraw')
}

function pure(tx: Transaction, argument: unknown, kind: 'u64' | 'bool') {
  const index = (argument as { Input: number }).Input
  const input = tx.getData().inputs[index]
  expect(input.$kind).toBe('Pure')
  const bytes = fromBase64(input.Pure!.bytes)
  return kind === 'u64' ? bcs.u64().parse(bytes) : bcs.bool().parse(bytes)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('navi.withdrawPTB call shape (navi_vault::withdraw)', () => {
  it('always draws from the default market, whose alternative charges a penalty', async () => {
    mockReceipts([{ id: '0xa', shares: 1_000n }])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'amount', amount: 100n })

    const [withdraw] = withdrawCalls(tx)
    // (vault, receipt, clock, oracle, storage, pool, amount, min_amount_out, from_default_market, ...)
    expect(withdraw.arguments).toHaveLength(12)
    expect(pure(tx, withdraw.arguments[6], 'u64')).toBe('100')
    expect(pure(tx, withdraw.arguments[8], 'bool')).toBe(true)
  })

  it('leaves the payout floor at zero unless the caller sets one', async () => {
    mockReceipts([{ id: '0xa', shares: 1_000n }])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'amount', amount: 100n })
    expect(pure(tx, withdrawCalls(tx)[0].arguments[7], 'u64')).toBe('0')
  })

  it('divides one minAmountOut across the receipts the withdrawal spans', async () => {
    // Rate is 1000 assets / 2000 shares, so 0xa is worth 50 and 0xb 250: 200 is drawn as
    // 50 (drained) + 150, splitting the floor 1:3.
    mockReceipts([
      { id: '0xa', shares: 100n },
      { id: '0xb', shares: 500n }
    ])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'amount', amount: 200n }, { minAmountOut: 1_000n })

    const calls = withdrawCalls(tx)
    expect(calls).toHaveLength(2)
    expect(pure(tx, calls[0].arguments[7], 'u64')).toBe('250')
    expect(pure(tx, calls[1].arguments[7], 'u64')).toBe('750')
  })

  it('weights a drain-everything plan by each receipt value, not by the U64_MAX sentinel', async () => {
    mockReceipts([
      { id: '0xa', shares: 100n },
      { id: '0xb', shares: 300n }
    ])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'all' }, { minAmountOut: 800n })

    const floors = withdrawCalls(tx).map((call) => BigInt(pure(tx, call.arguments[7], 'u64')))
    expect(floors).toEqual([200n, 600n])
    expect(floors.reduce((sum, floor) => sum + floor, 0n)).toBe(800n)
  })
})
