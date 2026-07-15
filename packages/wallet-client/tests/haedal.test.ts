import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

import dotenv from 'dotenv'

dotenv.config()

const signer = new WatchSigner(
  process.env.address || '0xe1e758d416cc140bea7175cbec2751f30e7be11b634fb0c8596226c5dea7b701'
)
const grpcUrl = process.env.SUI_GRPC_ENDPOINT || 'https://grpc.example'
const legacyJsonRpcUrl = (process.env.RPC_URL as string) || getJsonRpcFullnodeUrl('mainnet')

const walletClient = new WalletClient({
  signer: signer,
  client: {
    network: 'mainnet',
    grpc: {
      url: grpcUrl
    },
    legacyJsonRpc: {
      url: legacyJsonRpcUrl
    }
  }
})

const haedalModule = walletClient.module('haedal')
const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

describe.skipIf(!runLiveTests)('haedal module', () => {
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
