import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'

import {
  claimLendingRewardsPTB,
  getUserAvailableLendingRewards,
  getUserClaimedRewardHistory,
  getUserTotalClaimedReward,
  summaryLendingRewards
} from '../src/reward'
import type { LendingReward } from '../src/types'
import {
  TEST_ACCOUNT_CAP,
  TEST_ADDRESS,
  TEST_CONFIG,
  createPoolFixture,
  testObjectId
} from './fixtures'

const {
  depositCoinPTBMock,
  fetchMock,
  getConfigMock,
  getPoolsMock,
  getPriceFeedsMock,
  getUserEModeCapsMock
} = vi.hoisted(() => ({
  depositCoinPTBMock: vi.fn(),
  fetchMock: vi.fn(),
  getConfigMock: vi.fn(),
  getPoolsMock: vi.fn(),
  getPriceFeedsMock: vi.fn(),
  getUserEModeCapsMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

vi.mock('../src/pool', () => ({
  depositCoinPTB: depositCoinPTBMock,
  getPools: getPoolsMock
}))

vi.mock('../src/oracle', () => ({
  getPriceFeeds: getPriceFeedsMock
}))

vi.mock('../src/emode', () => ({
  getUserEModeCaps: getUserEModeCapsMock
}))

const REWARD_POOL = createPoolFixture({
  id: 0,
  coinType: '0x2::sui::SUI',
  suiCoinType: '0x2::sui::SUI',
  market: 'main',
  contract: {
    reserveId: testObjectId(70),
    pool: testObjectId(71),
    rewardFundId: testObjectId(72)
  }
})

function mockJsonResponse(payload: unknown): Response {
  return {
    json: async () => structuredClone(payload)
  } as Response
}

function encodeStringVector(values: string[]): Uint8Array {
  return bcs.vector(bcs.string()).serialize(values).toBytes()
}

function encodeU8Vector(values: number[]): Uint8Array {
  return bcs.vector(bcs.u8()).serialize(values).toBytes()
}

function encodeU256Vector(values: Array<string | number | bigint>): Uint8Array {
  return bcs
    .vector(bcs.u256())
    .serialize(values.map((value) => value.toString()))
    .toBytes()
}

function rewardResult(data: {
  assetCoinTypes: string[]
  rewardCoinTypes: string[]
  options: number[]
  ruleIds: string[]
  amounts: Array<string | number | bigint>
}) {
  return {
    returnValues: [
      [Array.from(encodeStringVector(data.assetCoinTypes)), 'vector<string>'],
      [Array.from(encodeStringVector(data.rewardCoinTypes)), 'vector<string>'],
      [Array.from(encodeU8Vector(data.options)), 'vector<u8>'],
      [Array.from(bcs.vector(bcs.Address).serialize(data.ruleIds).toBytes()), 'vector<address>'],
      [Array.from(encodeU256Vector(data.amounts)), 'vector<u256>']
    ]
  }
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

function createReward(overrides: Partial<LendingReward> = {}): LendingReward {
  return {
    assetId: 0,
    assetCoinType: '0x2::sui::SUI',
    rewardCoinType: '0x2::sui::SUI',
    option: 1,
    ruleIds: [testObjectId(80)],
    userClaimableReward: 1,
    market: 'main',
    owner: TEST_ADDRESS,
    address: TEST_ADDRESS,
    ...overrides
  }
}

describe('reward helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    getConfigMock.mockReset()
    getPoolsMock.mockReset()
    getPriceFeedsMock.mockReset()
    getUserEModeCapsMock.mockReset()
    depositCoinPTBMock.mockReset()

    getConfigMock.mockResolvedValue(TEST_CONFIG)
    getPoolsMock.mockResolvedValue([REWARD_POOL])
    getPriceFeedsMock.mockResolvedValue([
      {
        oracleId: 0,
        feedId: 'feed-sui',
        assetId: 0,
        pythPriceFeedId: 'pyth-sui',
        pythPriceInfoObject: testObjectId(73),
        coinType: '0x2::sui::SUI',
        priceDecimal: 9,
        supraPairId: 1
      }
    ])
    getUserEModeCapsMock.mockResolvedValue([
      {
        accountCap: TEST_ACCOUNT_CAP,
        emodeId: 1,
        marketId: 0
      }
    ])
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/navi/user/total_claimed_reward')) {
        return mockJsonResponse({
          data: {
            USDValue: url.includes(TEST_ADDRESS) ? 123.45 : 0
          }
        })
      }

      if (url.includes('/api/navi/user/rewards')) {
        return mockJsonResponse({
          data: {
            rewards: [
              {
                amount: '15',
                coin_type: '0x2::sui::SUI',
                pool: 'main-0',
                sender: TEST_ADDRESS,
                timestamp: '1711324800',
                token_price: 1.23
              }
            ]
          }
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  it('decodes claimable lending rewards from deterministic devInspect results', async () => {
    const client = {
      devInspectTransactionBlock: vi.fn(async ({ transactionBlock, sender }) => {
        expect(sender).toBe(TEST_ADDRESS)
        expect(transactionBlock.getData().commands).toHaveLength(2)
        expectMoveCall(transactionBlock, 0, {
          package: TEST_CONFIG.uiGetter,
          module: 'incentive_v3_getter',
          function: 'get_user_atomic_claimable_rewards'
        })
        expectMoveCall(transactionBlock, 1, {
          package: TEST_CONFIG.uiGetter,
          module: 'incentive_v3_getter',
          function: 'get_user_atomic_claimable_rewards'
        })

        return {
          results: [
            rewardResult({
              assetCoinTypes: ['0x2::sui::SUI'],
              rewardCoinTypes: ['0x2::sui::SUI'],
              options: [1],
              ruleIds: [testObjectId(81)],
              amounts: ['2500000000']
            }),
            rewardResult({
              assetCoinTypes: ['0x2::sui::SUI'],
              rewardCoinTypes: ['0x2::sui::SUI'],
              options: [2],
              ruleIds: [testObjectId(82)],
              amounts: ['1500000000']
            })
          ]
        }
      })
    }

    const rewards = await getUserAvailableLendingRewards(TEST_ADDRESS, {
      client: client as any
    })

    expect(rewards).toHaveLength(2)
    expect(rewards[0]).toMatchObject({
      assetId: 0,
      option: 1,
      owner: TEST_ADDRESS,
      address: TEST_ADDRESS,
      market: 'main',
      userClaimableReward: 2.5
    })
    expect(rewards[1]).toMatchObject({
      assetId: 0,
      option: 2,
      owner: TEST_ADDRESS,
      address: TEST_ACCOUNT_CAP,
      emodeId: 1,
      market: 'main',
      userClaimableReward: 1.5
    })
  })

  it('summarizes lending rewards by asset, type, and reward coin', () => {
    const summary = summaryLendingRewards([
      createReward({
        userClaimableReward: 1.25
      }),
      createReward({
        ruleIds: [testObjectId(83)],
        userClaimableReward: 0.75
      }),
      createReward({
        option: 2,
        ruleIds: [testObjectId(84)],
        userClaimableReward: 3
      })
    ])

    expect(summary).toEqual([
      {
        assetId: 0,
        rewardType: 1,
        market: 'main',
        rewards: [
          {
            coinType: '0x2::sui::SUI',
            available: '2.000000'
          }
        ]
      },
      {
        assetId: 0,
        rewardType: 2,
        market: 'main',
        rewards: [
          {
            coinType: '0x2::sui::SUI',
            available: '3.000000'
          }
        ]
      }
    ])
  })

  it('builds grouped reward-claim PTBs without a live dry-run', async () => {
    const tx = new Transaction()

    const rewardCoins = await claimLendingRewardsPTB(tx, [
      createReward({
        ruleIds: [testObjectId(85)],
        userClaimableReward: 1.25
      }),
      createReward({
        ruleIds: [testObjectId(86)],
        userClaimableReward: 0.75
      })
    ])

    expect(rewardCoins).toEqual([])
    expect(tx.getData().commands).toHaveLength(1)
    expectMoveCall(tx, 0, {
      package: TEST_CONFIG.package,
      module: 'incentive_v3',
      function: 'claim_reward_entry'
    })
    expect(getMoveCall(tx, 0).typeArguments).toEqual(['0x2::sui::SUI'])
    expect(depositCoinPTBMock).not.toHaveBeenCalled()
  })

  it('reads total claimed reward from the open-api response body', async () => {
    const totalClaimed = await getUserTotalClaimedReward(TEST_ADDRESS)
    const emptyClaimed = await getUserTotalClaimedReward(testObjectId(99))

    expect(totalClaimed).toEqual({ USDValue: 123.45 })
    expect(emptyClaimed).toEqual({ USDValue: 0 })
  })

  it('camelizes claimed reward history fields from the API response', async () => {
    const history = await getUserClaimedRewardHistory(TEST_ADDRESS, {
      page: 2,
      size: 20
    })

    expect(history).toEqual({
      data: [
        {
          amount: '15',
          coinType: '0x2::sui::SUI',
          pool: 'main-0',
          sender: TEST_ADDRESS,
          timestamp: '1711324800',
          tokenPrice: 1.23
        }
      ]
    })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('page=2')
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('pageSize=20')
  })
})
