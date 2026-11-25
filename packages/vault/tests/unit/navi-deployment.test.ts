import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vault } from '../../src/types'

const A = (hex: string) => normalizeSuiAddress(hex)
const POOL = A('0x9001')

vi.mock('@naviprotocol/lending', () => ({
  DEFAULT_CACHE_TIME: 1000,
  getPools: vi.fn(async () => [{ market: 'main', contract: { pool: POOL } }]),
  getConfig: vi.fn(async () => ({
    storage: A('0x570'),
    priceOracle: A('0x0ac1'),
    incentiveV2: A('0x11c2'),
    incentiveV3: A('0x11c3'),
    rewardFunds: { '0x2::sui::SUI': A('0xf00d') }
  })),
  getPriceFeeds: vi.fn(async () => []),
  filterPriceFeeds: vi.fn(() => []),
  updateOraclePricesPTB: vi.fn(async () => {})
}))
vi.mock('../../src/protocols/navi/vault', () => ({
  getVaultInfo: vi.fn(async () => ({
    total_assets: '1000',
    total_shares: '2000',
    markets: { contents: [{ key: A('0x1a'), value: { storage_address: A('0x570') } }] }
  })),
  getVaultDefaultPool: vi.fn(async () => ({
    market: 'main',
    contract: { pool: POOL }
  })),
  getVaultRewardRules: vi.fn(async () => [
    {
      isActive: true,
      isVaultNative: false,
      ruleIndex: 0,
      naviPoolId: POOL,
      rewardCoinType: '0x2::sui::SUI'
    }
  ])
}))
vi.mock('../../src/protocols/navi/receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/protocols/navi/receipt')>()
  return { ...actual, getVaultReceipts: vi.fn() }
})

import * as lending from '@naviprotocol/lending'
import { depositPTB, withdrawPTB } from '../../src/protocols/navi/ptb'
import { getVaultReceipts } from '../../src/protocols/navi/receipt'

const OWNER = A('0xabcd')
const PROD_PACKAGE = A('0x11a1')

const base: Vault = {
  id: A('0x9e5f'),
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
  navi: { package: PROD_PACKAGE }
}

const PROD_RECEIPT_TYPE =
  '0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c::navi_vault::Receipt'

// Inputs and commands, normalized to plain JSON. The fixtures under ./fixtures were generated
// from the pre-change sources (origin/main) under these same mocks.
const fullData = (tx: Transaction) => {
  const { inputs, commands } = tx.getData()
  return JSON.parse(JSON.stringify({ inputs, commands }))
}
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getVaultReceipts).mockResolvedValue([{ id: A('0xa'), shares: 1_000n }] as never)
})

describe('navi PTBs for a prod-shaped vault (no new fields)', () => {
  it('keeps the deposit transaction data unchanged', async () => {
    const tx = new Transaction()
    await depositPTB(tx, base, OWNER, 100n, { coin: tx.object(A('0xc01')) })
    expect(fullData(tx)).toEqual(fixture('prod-deposit.json'))
  })

  it('keeps the withdraw transaction data unchanged', async () => {
    const tx = new Transaction()
    await withdrawPTB(tx, base, OWNER, { kind: 'amount', amount: 100n })
    expect(fullData(tx)).toEqual(fixture('prod-withdraw.json'))
  })

  it('keeps the previous lending call shapes (prod env)', async () => {
    const tx = new Transaction()
    await withdrawPTB(tx, base, OWNER, { kind: 'amount', amount: 100n })
    expect(lending.getPriceFeeds).toHaveBeenCalledWith({ env: 'prod' })
    expect(vi.mocked(lending.updateOraclePricesPTB).mock.calls[0][2]).toMatchObject({
      env: 'prod',
      market: 'main'
    })
    // Pre-change literals are 'prod' by default, so the receipt type is the prod one.
    const types = tx
      .getData()
      .commands.flatMap((c) => (c.$kind === 'MoveCall' ? c.MoveCall.typeArguments : []))
    expect(types).not.toContain(PROD_RECEIPT_TYPE.replace('0x51ce', '0xdead'))
  })
})

describe('navi PTBs for a second deployment', () => {
  const STAGE_ORIGINAL = A('0xbdfc75fc')
  const stage: Vault = {
    ...base,
    navi: { package: A('0x9938904b'), originalPackage: STAGE_ORIGINAL, lendingEnv: 'dev' }
  }

  it('threads lendingEnv into every lending call on deposit', async () => {
    const tx = new Transaction()
    await depositPTB(tx, stage, OWNER, 100n, { coin: tx.object(A('0xc01')) })
    const pools = vi.mocked(lending.getPools).mock.calls
    const configs = vi.mocked(lending.getConfig).mock.calls
    expect(pools.length).toBeGreaterThan(0)
    expect(configs.length).toBeGreaterThan(0)
    for (const [opts] of [...pools, ...configs]) expect(opts).toMatchObject({ env: 'dev' })
  })

  it('threads lendingEnv into the oracle update on withdraw', async () => {
    const tx = new Transaction()
    await withdrawPTB(tx, stage, OWNER, { kind: 'amount', amount: 100n })
    expect(lending.getPriceFeeds).toHaveBeenCalledWith({ env: 'dev' })
    expect(vi.mocked(lending.updateOraclePricesPTB).mock.calls[0][2]).toMatchObject({
      env: 'dev'
    })
    for (const [opts] of [
      ...vi.mocked(lending.getPools).mock.calls,
      ...vi.mocked(lending.getConfig).mock.calls
    ]) {
      expect(opts).toMatchObject({ env: 'dev' })
    }
  })

  it('types the deposit receipt option with the stage original package', async () => {
    const tx = new Transaction()
    await depositPTB(tx, stage, OWNER, 100n, { coin: tx.object(A('0xc01')) })
    const optionCall = tx
      .getData()
      .commands.map((c) => (c.$kind === 'MoveCall' ? c.MoveCall : null))
      .find((c) => c?.function === 'some')
    expect(optionCall?.typeArguments).toEqual([`${STAGE_ORIGINAL}::navi_vault::Receipt`])
  })
})
