import './fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockWalletClient,
  fakeCoin,
  getMoveTargets,
  mockDryRunSuccess,
  setMockPortfolio
} from './test-utils'

const walletClient = createMockWalletClient(
  '0xe1e758d416cc140bea7175cbec2751f30e7be11b634fb0c8596226c5dea7b701'
)
const haedalModule = walletClient.module('haedal')
const suiCoinType = '0x2::sui::SUI'

describe('haedal module', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stake', async () => {
    let transaction
    setMockPortfolio(walletClient, [fakeCoin('0x31', suiCoinType, '1000000000')])
    mockDryRunSuccess(walletClient, (tx) => {
      transaction = tx
    })

    const result = await haedalModule.stake(1e9, {
      dryRun: true
    })

    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
    expect(transaction).toBeDefined()
    expect(transaction!.getData().commands[0].$kind).toBe('SplitCoins')
    expect(getMoveTargets(transaction!)).toContain(
      `${haedalModule.config.packageId}::staking::request_stake_coin`
    )
  })

  it('unstake', async () => {
    let transaction
    setMockPortfolio(walletClient, [
      fakeCoin('0x41', haedalModule.config.coinType, '1000000000'),
      fakeCoin('0x42', haedalModule.config.coinType, '1000000000')
    ])
    mockDryRunSuccess(walletClient, (tx) => {
      transaction = tx
    })

    const result = await haedalModule.unstake(1e9, {
      dryRun: true
    })

    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
    expect(transaction).toBeDefined()
    expect(getMoveTargets(transaction!)).toContain(
      `${haedalModule.config.packageId}::staking::request_unstake_instant_coin`
    )
  })

  it('getApy', async () => {
    const apy = await haedalModule.getApy()
    expect(Number(apy)).toBeGreaterThan(0)
  })
})
