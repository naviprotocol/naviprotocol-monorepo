import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import type { CoinStruct } from '@mysten/sui/client'

import {
  getCoins,
  getHealthFactor,
  getLendingState,
  getSimulatedHealthFactor,
  getTransactions,
  mergeCoinsPTB,
  UserPositions
} from '../src/account'
import { PoolOperator } from '../src/pool'
import type { EnvOption } from '../src/types'
import {
  TEST_ADDRESS,
  TEST_CONFIG,
  createPoolFixture,
  devInspectResultFromBytes,
  encodeU256,
  encodeUserStates
} from './fixtures'

const { fetchMock, getConfigMock, getPoolMock, getPoolsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getConfigMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPoolsMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

vi.mock('../src/pool', async () => {
  const actual = await vi.importActual<typeof import('../src/pool')>('../src/pool')
  return {
    ...actual,
    getPool: getPoolMock,
    getPools: getPoolsMock
  }
})

const options = {
  env: 'test'
} as EnvOption

const mainPool = createPoolFixture()
const emptyAddress = `0x${'9'.repeat(64)}`

describe('account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    getConfigMock.mockResolvedValue(TEST_CONFIG)
    getPoolMock.mockResolvedValue(mainPool)
    getPoolsMock.mockResolvedValue([mainPool])
  })

  describe('getLendingState', () => {
    it('returns an empty state when the user has no positions', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValue(devInspectResultFromBytes(encodeUserStates([])))
      }

      const state = await getLendingState(emptyAddress, {
        ...options,
        client: client as any,
        markets: ['main'],
        disableCache: true
      })

      expect(state).toEqual([])
    })

    it('maps supply and borrow balances from dev inspect data', async () => {
      const client = {
        devInspectTransactionBlock: vi.fn().mockResolvedValue(
          devInspectResultFromBytes(
            encodeUserStates([
              {
                asset_id: mainPool.id,
                supply_balance: '2000000000',
                borrow_balance: '500000000'
              }
            ])
          )
        )
      }

      const state = await getLendingState(TEST_ADDRESS, {
        ...options,
        client: client as any,
        markets: ['main'],
        disableCache: true
      })

      expect(state).toHaveLength(1)
      expect(state[0]).toMatchObject({
        assetId: mainPool.id,
        market: 'main',
        supplyBalance: '2000000000',
        borrowBalance: '500000000'
      })
      expect(state[0].pool.id).toBe(mainPool.id)
    })
  })

  describe('getHealthFactor', () => {
    it('parses a normal health factor result', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValue(devInspectResultFromBytes(encodeU256('2000000000000000000000000000')))
      }

      const healthFactor = await getHealthFactor(TEST_ADDRESS, {
        ...options,
        client: client as any
      })

      expect(healthFactor).toBe(2)
    })

    it('returns Infinity for very large health factors', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValue(
            devInspectResultFromBytes(encodeU256('100001000000000000000000000000000'))
          )
      }

      const healthFactor = await getHealthFactor(TEST_ADDRESS, {
        ...options,
        client: client as any
      })

      expect(healthFactor).toBe(Infinity)
    })
  })

  describe('getSimulatedHealthFactor', () => {
    it('increases health factor for supply operations', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('2000000000000000000000000000'))
          )
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('3000000000000000000000000000'))
          )
      }

      const lastHf = await getSimulatedHealthFactor(TEST_ADDRESS, mainPool, [], {
        ...options,
        client: client as any
      })
      const currentHf = await getSimulatedHealthFactor(
        TEST_ADDRESS,
        mainPool,
        [
          {
            type: PoolOperator.Supply,
            amount: 1e9
          }
        ],
        {
          ...options,
          client: client as any
        }
      )

      expect(currentHf).toBeGreaterThan(lastHf)
    })

    it('decreases health factor for withdraw operations', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('2000000000000000000000000000'))
          )
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('1800000000000000000000000000'))
          )
      }

      const lastHf = await getSimulatedHealthFactor(TEST_ADDRESS, mainPool, [], {
        ...options,
        client: client as any
      })
      const currentHf = await getSimulatedHealthFactor(
        TEST_ADDRESS,
        mainPool,
        [
          {
            type: PoolOperator.Withdraw,
            amount: 3 * Math.pow(10, mainPool.token.decimals)
          }
        ],
        {
          ...options,
          client: client as any
        }
      )

      expect(currentHf).toBeLessThan(lastHf)
      expect(Math.abs(currentHf - lastHf)).toBeGreaterThan(0.03)
    })

    it('decreases health factor for borrow operations', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('2000000000000000000000000000'))
          )
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('1700000000000000000000000000'))
          )
      }

      const lastHf = await getSimulatedHealthFactor(TEST_ADDRESS, mainPool, [], {
        ...options,
        client: client as any
      })
      const currentHf = await getSimulatedHealthFactor(
        TEST_ADDRESS,
        mainPool,
        [
          {
            type: PoolOperator.Borrow,
            amount: 3 * Math.pow(10, mainPool.token.decimals)
          }
        ],
        {
          ...options,
          client: client as any
        }
      )

      expect(currentHf).toBeLessThan(lastHf)
      expect(Math.abs(currentHf - lastHf)).toBeGreaterThan(0.03)
    })

    it('keeps repay simulations within a bounded tolerance of the baseline', async () => {
      const client = {
        devInspectTransactionBlock: vi
          .fn()
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('2000000000000000000000000000'))
          )
          .mockResolvedValueOnce(
            devInspectResultFromBytes(encodeU256('1999500000000000000000000000'))
          )
      }

      const lastHf = await getSimulatedHealthFactor(TEST_ADDRESS, mainPool, [], {
        ...options,
        client: client as any
      })
      const currentHf = await getSimulatedHealthFactor(
        TEST_ADDRESS,
        mainPool,
        [
          {
            type: PoolOperator.Repay,
            amount: 1 * Math.pow(10, mainPool.token.decimals)
          }
        ],
        {
          ...options,
          client: client as any
        }
      )

      expect(currentHf).toBeGreaterThan(lastHf - 1e-3)
    })
  })

  describe('getTransactions', () => {
    it('returns transactions and cursor data', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => ({
          data: {
            data: [
              {
                type: 'Supply',
                status: 'success',
                coinChanges: [{ symbol: 'SUI', amount: '1' }],
                timestamp: '123',
                digest: '0x1'
              }
            ],
            cursor: 'next-cursor'
          }
        })
      } as Response)

      const res = await getTransactions(TEST_ADDRESS)

      expect(res.data).toHaveLength(1)
      expect(res.cursor).toBe('next-cursor')
      expect(String(fetchMock.mock.calls[0][0])).toContain('userAddress=')
    })

    it('passes the cursor through to the API request', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => ({
          data: {
            data: [
              {
                type: 'Borrow',
                status: 'success',
                coinChanges: [{ symbol: 'USDC', amount: '2' }],
                timestamp: '456',
                digest: '0x2'
              }
            ]
          }
        })
      } as Response)

      const res = await getTransactions(TEST_ADDRESS, {
        cursor: 'cursor-1'
      })

      expect(res.data).toHaveLength(1)
      expect(String(fetchMock.mock.calls[0][0])).toContain('cursor=cursor-1')
    })

    it('handles users with no transactions', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => ({
          data: {
            data: []
          }
        })
      } as Response)

      const res = await getTransactions(emptyAddress)

      expect(res.data).toEqual([])
    })
  })

  describe('getCoins', () => {
    it('returns all coins across pages', async () => {
      const client = {
        getAllCoins: vi
          .fn()
          .mockResolvedValueOnce({
            data: [
              {
                coinObjectId: '0x1',
                balance: '10',
                coinType: '0x2::sui::SUI'
              }
            ],
            nextCursor: 'cursor-1'
          })
          .mockResolvedValueOnce({
            data: [
              {
                coinObjectId: '0x2',
                balance: '20',
                coinType: '0x3::usdc::USDC'
              }
            ],
            nextCursor: null
          })
      }

      const coins = await getCoins(TEST_ADDRESS, {
        client: client as any
      })

      expect(coins).toHaveLength(2)
    })

    it('filters coins by coinType', async () => {
      const coinType = '0x3::usdc::USDC'
      const client = {
        getCoins: vi.fn().mockResolvedValue({
          data: [
            {
              coinObjectId: '0x3',
              balance: '30',
              coinType
            }
          ],
          nextCursor: null
        })
      }

      const coins = await getCoins(TEST_ADDRESS, {
        client: client as any,
        coinType
      })

      expect(coins).toHaveLength(1)
      expect(coins[0].coinType).toBe(coinType)
    })
  })
})

describe('mergeCoinsPTB', () => {
  const fakeCoins = [
    {
      coinObjectId: '0x1',
      balance: '10',
      coinType: '0x1',
      digest: '0x1',
      previousTransaction: '0x1',
      version: ''
    },
    {
      coinObjectId: '0x2',
      balance: '20',
      coinType: '0x1',
      digest: '0x2',
      previousTransaction: '0x2',
      version: ''
    }
  ] as CoinStruct[]

  it('no coins to merge', () => {
    const tx = new Transaction()
    expect(() => mergeCoinsPTB(tx, [])).toThrow('No coins to merge')
    expect(() => mergeCoinsPTB(tx, [], { balance: 100 })).toThrow('No coins to merge')
    expect(() =>
      mergeCoinsPTB(
        tx,
        [
          {
            coinObjectId: '0x2',
            balance: '0',
            coinType: '0x2',
            digest: '0x2',
            previousTransaction: '0x2',
            version: ''
          }
        ] as CoinStruct[],
        { balance: 100 }
      )
    ).toThrow('No coins to merge')
  })

  it('Balance is less than the specified balance', () => {
    const tx = new Transaction()
    expect(() => mergeCoinsPTB(tx, fakeCoins, { balance: 100 })).toThrow(
      'Balance is less than the specified balance: 30 < 100'
    )
  })

  it('merge vsui coins', () => {
    const coinType =
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    const userCoins = [
      {
        coinObjectId: '0x11',
        balance: '600000000',
        coinType,
        digest: '0x11',
        previousTransaction: '0x11',
        version: ''
      },
      {
        coinObjectId: '0x12',
        balance: '500000000',
        coinType,
        digest: '0x12',
        previousTransaction: '0x12',
        version: ''
      }
    ] as CoinStruct[]
    const tx = new Transaction()
    const result = mergeCoinsPTB(tx, userCoins)

    expect(result).toBe('0x11')
    expect(tx.getData().commands).toHaveLength(1)
    expect(tx.getData().commands[0].$kind).toBe('MergeCoins')
  })

  it('merge sui coins', () => {
    const coinType = '0x2::sui::SUI'
    const userCoins = [
      {
        coinObjectId: '0x21',
        balance: '600000000',
        coinType,
        digest: '0x21',
        previousTransaction: '0x21',
        version: ''
      },
      {
        coinObjectId: '0x22',
        balance: '500000000',
        coinType,
        digest: '0x22',
        previousTransaction: '0x22',
        version: ''
      }
    ] as CoinStruct[]
    const tx = new Transaction()
    const result = mergeCoinsPTB(tx, userCoins, {
      useGasCoin: true,
      balance: 1e9
    })

    expect(result).toBeDefined()
    expect(tx.getData().commands).toHaveLength(1)
    expect(tx.getData().commands[0].$kind).toBe('SplitCoins')
  })
})

describe('UserPositions.getPositionsOverview', () => {
  it('should avoid NaN when totalSupplyValue is zero', () => {
    const positions = [
      {
        id: 'supply-zero',
        wallet: TEST_ADDRESS,
        protocol: 'navi',
        market: 'main',
        type: 'navi-lending-supply',
        'navi-lending-supply': {
          amount: '100',
          valueUSD: '0',
          token: {
            coinType: '0x2::sui::SUI',
            decimals: 9,
            logoUri: '',
            symbol: 'SUI',
            price: 0
          },
          pool: {
            supplyIncentiveApyInfo: { apy: '12.34' },
            liquidationFactor: { threshold: 0.8 },
            ltvValue: 0.75,
            suiCoinType: '0x2::sui::SUI'
          } as any
        }
      }
    ] as any

    const overview = new UserPositions([]).getPositionsOverview(positions)

    expect(overview.totalSupplyValue).toBe('0')
    expect(overview.totalsupplyApy).toBe('0')
    expect(overview.netWorthApr).toBe('0')
    expect(overview.totalsupplyApy).not.toBe('NaN')
    expect(overview.netWorthApr).not.toBe('NaN')
  })
})
