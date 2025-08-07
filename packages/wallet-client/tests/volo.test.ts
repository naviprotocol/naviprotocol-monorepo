import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'

import dotenv from 'dotenv'

dotenv.config()

const signer = new WatchSigner('0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e')

const walletClient = new WalletClient({
  signer: signer,
  client: {
    url: (process.env.RPC_URL as string) || getFullnodeUrl('mainnet')
  }
})

const voloModule = walletClient.module('volo')

describe('volo module', () => {
  it('stake', async () => {
    const result = await voloModule.stake(1e9 * 1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('unstake', async () => {
    const result = await voloModule.unstake(1e9 * 1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('getStats', async () => {
    const stats = await voloModule.getStats()
    expect(stats).toBeDefined()
    expect(stats.validators.length).toBeGreaterThan(0)
    expect(Number(stats.totalStaked)).toBeGreaterThan(0)
    expect(Number(stats.totalRewardsInStakes)).toBeGreaterThan(0)
    expect(Number(stats.activeStake)).toBeGreaterThan(0)
    expect(Number(stats.pendingStakes)).toBeGreaterThan(0)
    expect(Number(stats.collectableFee)).toBeGreaterThan(0)
    expect(Number(stats.operatorBalance)).toBeGreaterThan(0)
    expect(Number(stats.currentEpoch)).toBeGreaterThan(0)
    expect(Number(stats.totalStakers)).toBeGreaterThan(0)
    expect(Number(stats.lastUpdated)).toBeGreaterThan(0)
    expect(Number(stats.apy)).toBeGreaterThan(0)
    expect(Number(stats.exchangeRate)).toBeGreaterThan(0)
    expect(Number(stats.totalSupply)).toBeGreaterThan(0)
  })
})
