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

const swapModule = walletClient.module('swap')

describe('swap module', () => {
  it('swap 1 sui to navx', async () => {
    const res = await swapModule.swap(
      '0x2::sui::SUI',
      '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
      1e9 * 1,
      0.01,
      {
        dryRun: true
      }
    )

    expect(res).toBeDefined()
    expect(res.events.length).toBeGreaterThan(0)
  })
})
