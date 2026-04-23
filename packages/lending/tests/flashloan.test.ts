import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'

import {
  flashloanPTB,
  getAllFlashLoanAssets,
  getFlashLoanAsset,
  repayFlashLoanPTB
} from '../src/flashloan'
import { TEST_CONFIG, TEST_FLASHLOAN_ASSET, createPoolFixture, testObjectId } from './fixtures'

const { fetchMock, getConfigMock, getPoolMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getConfigMock: vi.fn(),
  getPoolMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

vi.mock('../src/pool', () => ({
  getPool: getPoolMock
}))

const mockPool = createPoolFixture({
  id: TEST_FLASHLOAN_ASSET.assetId,
  contract: {
    reserveId: testObjectId(26),
    pool: TEST_FLASHLOAN_ASSET.poolId
  }
})

function getMoveCall(tx: Transaction, index: number) {
  const command = tx.getData().commands[index]
  expect(command?.$kind).toBe('MoveCall')
  return (command as any).MoveCall
}

describe('flashloan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    getConfigMock.mockResolvedValue(TEST_CONFIG)
    getPoolMock.mockResolvedValue(mockPool)
    fetchMock.mockResolvedValue({
      json: async () => ({
        data: {
          [TEST_FLASHLOAN_ASSET.coinType]: {
            assetId: TEST_FLASHLOAN_ASSET.assetId,
            poolId: TEST_FLASHLOAN_ASSET.poolId,
            supplierFee: TEST_FLASHLOAN_ASSET.supplierFee,
            flashloanFee: TEST_FLASHLOAN_ASSET.flashloanFee,
            max: TEST_FLASHLOAN_ASSET.max,
            min: TEST_FLASHLOAN_ASSET.min
          }
        }
      })
    } as Response)
  })

  it('fetches flashloan assets for prod', async () => {
    const assets = await getAllFlashLoanAssets({
      disableCache: true
    })

    expect(assets).toEqual([TEST_FLASHLOAN_ASSET])
    expect(String(fetchMock.mock.calls[0][0])).toContain('env=prod')
    expect(String(fetchMock.mock.calls[0][0])).toContain('market=main')
  })

  it('fetches flashloan assets for dev', async () => {
    const assets = await getAllFlashLoanAssets({
      env: 'dev',
      disableCache: true
    })

    expect(assets).toEqual([TEST_FLASHLOAN_ASSET])
    expect(String(fetchMock.mock.calls[0][0])).toContain('env=dev')
  })

  it('finds flashloan assets by different identifiers', async () => {
    expect(await getFlashLoanAsset(TEST_FLASHLOAN_ASSET.coinType)).toEqual(TEST_FLASHLOAN_ASSET)
    expect(await getFlashLoanAsset(TEST_FLASHLOAN_ASSET.assetId)).toEqual(TEST_FLASHLOAN_ASSET)
    expect(await getFlashLoanAsset(mockPool)).toEqual(TEST_FLASHLOAN_ASSET)
  })

  it('builds flashloan and repay PTBs against the configured pool', async () => {
    const tx = new Transaction()
    const [, receipt] = await flashloanPTB(tx, mockPool.suiCoinType, 1_000_000_000)

    await repayFlashLoanPTB(tx, mockPool.suiCoinType, receipt, tx.object(`0x${'3'.repeat(64)}`))

    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('flash_loan_with_ctx_v2')
    expect(getMoveCall(tx, 1).function).toBe('flash_repay_with_ctx')
  })
})
