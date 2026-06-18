import './fetch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureNaviSdk } from '@naviprotocol/lending'
import { WalletClient, WatchSigner } from '../src'

const DEFAULT_NAVI_OPEN_API_BASE_URL = 'https://open-api.naviprotocol.io/api'
const address = `0x${'1'.repeat(64)}`

function createWalletClient(
  configs: ConstructorParameters<typeof WalletClient>[0]['configs'] = {}
) {
  const walletClient = new WalletClient({
    signer: new WatchSigner(address),
    configs: {
      balance: {
        disableCoinPolling: true
      },
      ...configs
    },
    client: {
      url: 'https://json-rpc.example'
    }
  })
  walletClient.module('balance').uninstall()
  return walletClient
}

describe('wallet service endpoint configuration', () => {
  afterEach(() => {
    configureNaviSdk({
      services: {
        naviOpenApi: {
          baseUrl: DEFAULT_NAVI_OPEN_API_BASE_URL
        }
      }
    })
    vi.unstubAllGlobals()
  })

  it('uses per-call Open API endpoint overrides for Volo stats', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        data: {
          validators: []
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const walletClient = createWalletClient()

    await walletClient.module('volo').getStats({
      services: {
        naviOpenApi: {
          baseUrl: 'https://preview-open-api.example/api',
          headers: {
            'x-navi-preview': '1'
          }
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith('https://preview-open-api.example/api/volo/stats', {
      headers: {
        'x-navi-preview': '1'
      }
    })
  })

  it('uses module-level Open API endpoint overrides for Haedal APY', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        data: {
          apy: 12.3
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const walletClient = createWalletClient({
      haedal: {
        services: {
          naviOpenApi: {
            baseUrl: 'https://wallet-open-api.example/api',
            headers: {
              'x-wallet-preview': '1'
            }
          }
        }
      }
    })

    await expect(walletClient.module('haedal').getApy()).resolves.toBe(12.3)
    expect(fetchMock).toHaveBeenCalledWith('https://wallet-open-api.example/api/haedal/stats', {
      headers: {
        'x-wallet-preview': '1'
      }
    })
  })
})
