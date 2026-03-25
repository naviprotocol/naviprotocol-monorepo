import './fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockWalletClient,
  fakeCoin,
  getMoveTargets,
  mockDryRunSuccess,
  setMockPortfolio
} from './test-utils'

const walletClient = createMockWalletClient()
const swapModule = walletClient.module('swap')
const suiCoinType = '0x2::sui::SUI'
const navxCoinType =
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'

describe('swap module', () => {
  beforeEach(() => {
    setMockPortfolio(walletClient, [fakeCoin('0x11', suiCoinType, '1000000000')])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('swap 1 sui to navx', async () => {
    let transaction
    mockDryRunSuccess(walletClient, (tx) => {
      transaction = tx
    })
    vi.spyOn(swapModule, 'getQuote').mockResolvedValue({
      amount_out: '30238616272'
    } as any)
    vi.spyOn(swapModule, 'buildSwapPTBFromQuote').mockImplementation(async (tx) => {
      return tx.object('0x22') as any
    })

    const res = await swapModule.swap(suiCoinType, navxCoinType, 1e9 * 0.4, 0.01, {
      dryRun: true
    })

    expect(res).toBeDefined()
    expect(res.events.length).toBeGreaterThan(0)
    expect(swapModule.getQuote).toHaveBeenCalledWith(suiCoinType, navxCoinType, 1e9 * 0.4)
    expect(transaction).toBeDefined()
    expect(transaction!.getData().commands[0].$kind).toBe('SplitCoins')
    expect(transaction!.getData().commands.at(-1)?.$kind).toBe('TransferObjects')
    expect(getMoveTargets(transaction!)).toEqual([])
  })
})
