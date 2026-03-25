import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'

import {
  borrowCoinPTB,
  depositCoinPTB,
  getBorrowFee,
  getFees,
  getPools,
  getStats,
  repayCoinPTB,
  withdrawCoinPTB
} from '../src/pool'
import type { FeeDetail, Pool, PoolStats } from '../src/types'
import { TEST_CONFIG, TEST_EMODE, TEST_ADDRESS, createPoolFixture, testObjectId } from './fixtures'

const { fetchMock, getConfigMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getConfigMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

const USDC_COIN_TYPE = `${testObjectId(30)}::usdc::USDC`

const TEST_STATS: PoolStats = {
  tvl: 1000,
  totalBorrowUsd: 250,
  averageUtilization: 0.42,
  maxApy: 0.18,
  userAmount: 128,
  interactionUserAmount: 64,
  borrowFee: 0.2,
  borrowFeeAddress: TEST_ADDRESS
}

const TEST_FEE_DETAIL: FeeDetail = {
  coinId: testObjectId(31),
  coinSymbol: 'SUI',
  coinType: '0x2::sui::SUI',
  feeObjectId: testObjectId(32),
  currentAmount: 12,
  price: 2,
  currentValue: 24
}

const TEST_FEES = {
  totalValue: 42,
  v3BorrowFee: {
    totalValue: 12,
    details: [TEST_FEE_DETAIL]
  },
  borrowInterestFee: {
    totalValue: 20,
    details: [TEST_FEE_DETAIL]
  },
  flashloanAndLiquidationFee: {
    totalValue: 10,
    details: [TEST_FEE_DETAIL]
  }
}

function mockJsonResponse(payload: unknown): Response {
  return {
    json: async () => structuredClone(payload)
  } as Response
}

function encodeU64(value: number | bigint): Uint8Array {
  return bcs.u64().serialize(BigInt(value)).toBytes()
}

function getMoveCall(tx: Transaction, index: number) {
  const command = tx.getData().commands[index]
  expect(command?.$kind).toBe('MoveCall')
  return (command as any).MoveCall
}

function expectMoveCall(
  tx: Transaction,
  index: number,
  expected: {
    package?: string
    module?: string
    function?: string
  }
) {
  const moveCall = getMoveCall(tx, index)
  if (expected.package) {
    expect(moveCall.package).toBe(expected.package)
  }
  if (expected.module) {
    expect(moveCall.module).toBe(expected.module)
  }
  if (expected.function) {
    expect(moveCall.function).toBe(expected.function)
  }
  return moveCall
}

function createPoolsResponse(env: 'prod' | 'dev') {
  const suiPoolId = env === 'dev' ? 8 : 0
  const stablePoolId = env === 'dev' ? 9 : 1

  const suiPool = createPoolFixture({
    uniqueId: `main-${suiPoolId}`,
    id: suiPoolId,
    totalSupplyAmount: '2500000000',
    borrowedAmount: '500000000',
    validBorrowAmount: '1000000000',
    supplyCapCeiling: '5000000000000000000000000000',
    oracle: {
      price: '2'
    }
  })

  const stablePool = createPoolFixture({
    uniqueId: `main-${stablePoolId}`,
    id: stablePoolId,
    coinType: USDC_COIN_TYPE,
    suiCoinType: USDC_COIN_TYPE,
    totalSupplyAmount: '123450000000',
    borrowedAmount: '1250000000',
    validBorrowAmount: '2500000000',
    supplyCapCeiling: '300000000000000000000000000000',
    market: 'main',
    token: {
      coinType: USDC_COIN_TYPE,
      decimals: 6,
      logoUri: '',
      symbol: 'USDC',
      price: 1.5
    },
    oracle: {
      decimal: 6,
      value: '1500000',
      price: '1.5',
      oracleId: 1,
      valid: true
    },
    contract: {
      reserveId: testObjectId(40 + stablePoolId),
      pool: testObjectId(50 + stablePoolId)
    }
  })

  return {
    data: [suiPool, stablePool] satisfies Pool[],
    meta: {
      emodes: [
        TEST_EMODE,
        {
          ...TEST_EMODE,
          uniqueId: 'main-2',
          isActive: false
        }
      ]
    }
  }
}

describe('pool read APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/navi/pools')) {
        return mockJsonResponse(createPoolsResponse(url.includes('env=dev') ? 'dev' : 'prod'))
      }

      if (url.includes('/api/navi/stats')) {
        return mockJsonResponse({ data: TEST_STATS })
      }

      if (url.includes('/api/navi/fee')) {
        return mockJsonResponse(TEST_FEES)
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  it('transforms pool API data into derived lending metrics', async () => {
    const pools = await getPools({
      disableCache: true
    })

    expect(pools).toHaveLength(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('market=main')

    const suiPool = pools.find((pool) => pool.coinType === '0x2::sui::SUI')
    const stablePool = pools.find((pool) => pool.coinType === USDC_COIN_TYPE)

    expect(suiPool?.emodes).toHaveLength(1)
    expect(suiPool?.poolSupplyAmount).toBe('2.5')
    expect(suiPool?.poolBorrowAmount).toBe('0.5')
    expect(suiPool?.poolSupplyValue).toBe('5')
    expect(suiPool?.poolSupplyCapAmount).toBe('5')
    expect(suiPool?.poolBorrowCapAmount).toBe('1')

    expect(stablePool?.poolSupplyAmount).toBe('123.45')
    expect(stablePool?.poolBorrowAmount).toBe('1.25')
    expect(stablePool?.poolBorrowCapAmount).toBe('2.5')
    expect(stablePool?.poolSupplyCapValue).toBe('450')
  })

  it('returns protocol stats from the API response payload', async () => {
    const stats = await getStats({
      disableCache: true
    })

    expect(stats).toEqual(TEST_STATS)
  })

  it('returns fee breakdowns from the API response payload', async () => {
    const fees = await getFees({
      disableCache: true
    })

    expect(fees).toEqual(TEST_FEES)
  })
})

describe('pool PTB builders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
    fetchMock.mockResolvedValue(mockJsonResponse(createPoolsResponse('dev')))
  })

  it('builds a gas-coin deposit PTB without live dry-run dependencies', async () => {
    const tx = new Transaction()

    const result = await depositCoinPTB(tx, '0x2::sui::SUI', tx.gas, {
      env: 'dev',
      amount: 200_000_000
    })

    expect(result).toBe(tx)
    expect(tx.getData().commands).toHaveLength(2)
    expect(tx.getData().commands[0].$kind).toBe('SplitCoins')
    expectMoveCall(tx, 1, {
      package: TEST_CONFIG.package,
      module: 'incentive_v3',
      function: 'entry_deposit'
    })
  })

  it('builds a v2 withdraw PTB and wraps the balance into a coin', async () => {
    const tx = new Transaction()

    const coin = await withdrawCoinPTB(tx, '0x2::sui::SUI', 150_000_000, {
      env: 'dev'
    })

    expect(coin).toBeDefined()
    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('withdraw_v2')
    expectMoveCall(tx, 1, {
      module: 'coin',
      function: 'from_balance'
    })
  })

  it('builds a v2 borrow PTB and wraps the balance into a coin', async () => {
    const tx = new Transaction()

    const coin = await borrowCoinPTB(tx, '0x2::sui::SUI', 125_000_000, {
      env: 'dev'
    })

    expect(coin).toBeDefined()
    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('borrow_v2')
    expectMoveCall(tx, 1, {
      module: 'coin',
      function: 'from_balance'
    })
  })

  it('builds a repay PTB by splitting the gas coin and calling entry_repay', async () => {
    const tx = new Transaction()

    const result = await repayCoinPTB(tx, '0x2::sui::SUI', tx.gas, {
      env: 'dev',
      amount: 100_000_000
    })

    expect(result).toBe(tx)
    expect(tx.getData().commands).toHaveLength(2)
    expect(tx.getData().commands[0].$kind).toBe('SplitCoins')
    expectMoveCall(tx, 1, {
      package: TEST_CONFIG.package,
      module: 'incentive_v3',
      function: 'entry_repay'
    })
  })
})

describe('getBorrowFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
    fetchMock.mockResolvedValue(mockJsonResponse(createPoolsResponse('dev')))
  })

  it('parses the devInspect borrow fee response deterministically', async () => {
    const client = {
      devInspectTransactionBlock: vi.fn(async ({ transactionBlock, sender }) => {
        expect(sender).toBe(TEST_ADDRESS)
        expect(transactionBlock.getData().commands).toHaveLength(1)
        expectMoveCall(transactionBlock, 0, {
          package: TEST_CONFIG.package,
          module: 'incentive_v3',
          function: 'get_borrow_fee_v2'
        })

        return {
          results: [
            {
              returnValues: [[Array.from(encodeU64(250)), 'u64']]
            }
          ]
        }
      })
    }

    const fee = await getBorrowFee({
      env: 'dev',
      address: TEST_ADDRESS,
      asset: '0x2::sui::SUI',
      client: client as any,
      disableCache: true
    })

    expect(fee).toBe(2.5)
  })
})
