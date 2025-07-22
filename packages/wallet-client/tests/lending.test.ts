import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'

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

describe('lending module', () => {
  it('deposit SUI', async () => {
    const result = await walletClient.lending.deposit('0x2::sui::SUI', 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('deposit vSUI', async () => {
    const result = await walletClient
      .module('lending')
      .deposit(
        '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
        1e9 * 0.4,
        {
          dryRun: true
        }
      )
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('withdraw SUI', async () => {
    const result = await walletClient
      .module('lending')
      .withdraw(
        '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
        1e9 * 0.1,
        {
          dryRun: true
        }
      )
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('borrow SUI', async () => {
    const result = await walletClient.module('lending').borrow('0x2::sui::SUI', 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('repay SUI', async () => {
    const result = await walletClient.module('lending').repay('0x2::sui::SUI', 1e9 * 0.1, {
      dryRun: true
    })
    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
  it('get health factor', async () => {
    const healthFactor = await walletClient.module('lending').getHealthFactor()
    console.log(healthFactor)
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
