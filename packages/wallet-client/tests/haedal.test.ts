import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'

import dotenv from 'dotenv'

dotenv.config()

const signer = new WatchSigner(
  process.env.address || '0xe1e758d416cc140bea7175cbec2751f30e7be11b634fb0c8596226c5dea7b701'
)

const walletClient = new WalletClient({
  signer: signer,
  client: {
    url: process.env.RPC_URL as string
  }
})

const haedalModule = walletClient.module('haedal')

describe('haedal module', () => {
  it('stake', async () => {
    const result = await haedalModule.stake(1e9 * 1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('unstake', async () => {
    const result = await haedalModule.unstake(1e9 * 1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('getApy', async () => {
    const apy = await haedalModule.getApy()
    expect(Number(apy)).toBeGreaterThan(0)
  })
})
