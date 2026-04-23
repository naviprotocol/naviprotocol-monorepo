import './fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'
import {
  createMockWalletClient,
  fakeCoin,
  getMoveTargets,
  mockDryRunSuccess,
  setMockPortfolio
} from './test-utils'

import dotenv from 'dotenv'

dotenv.config()

const signer = new WatchSigner(
  process.env.address || '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
)

const walletClient = new WalletClient({
  signer: signer,
  client: {
    url: (process.env.RPC_URL as string) || getFullnodeUrl('mainnet')
  }
})
const mockedWalletClient = createMockWalletClient()
const mockedLendingModule = mockedWalletClient.module('lending')
const suiCoinType = '0x2::sui::SUI'
const vsuiCoinType =
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'

describe('lending module', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deposit SUI', async () => {
    const result = await walletClient.lending.deposit(suiCoinType, 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('deposit vSUI', async () => {
    let transaction
    setMockPortfolio(mockedWalletClient, [fakeCoin('0x51', vsuiCoinType, '500000000')])
    mockDryRunSuccess(mockedWalletClient, (tx) => {
      transaction = tx
    })

    const result = await mockedLendingModule.deposit(vsuiCoinType, 1e9 * 0.4, {
      dryRun: true
    })

    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
    expect(getMoveTargets(transaction!)).toContainEqual(expect.stringContaining('entry_deposit'))
  })

  it('withdraw SUI', async () => {
    const result = await walletClient.module('lending').withdraw(vsuiCoinType, 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('borrow SUI', async () => {
    const result = await walletClient.module('lending').borrow(suiCoinType, 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('repay SUI', async () => {
    let transaction
    setMockPortfolio(mockedWalletClient, [fakeCoin('0x61', suiCoinType, '1000000000')])
    mockDryRunSuccess(mockedWalletClient, (tx) => {
      transaction = tx
    })

    const result = await mockedLendingModule.repay(suiCoinType, 1e9 * 0.1, {
      dryRun: true
    })

    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
    expect(transaction!.getData().commands[0].$kind).toBe('SplitCoins')
    expect(getMoveTargets(transaction!)).toContainEqual(expect.stringContaining('entry_repay'))
  })

  it('get health factor', async () => {
    const healthFactor = await walletClient.module('lending').getHealthFactor()
    expect(healthFactor).toBeDefined()
  })

  it('claim all rewards', async () => {
    const result = await walletClient.module('lending').claimAllRewards({
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('update oracle', async () => {
    const result = await walletClient.module('lending').updateOracle({
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('getLendingState', async () => {
    const result = await walletClient.module('lending').getLendingState()
    expect(result).toBeDefined()
    expect(result.length).toBeGreaterThan(0)
  })
})
