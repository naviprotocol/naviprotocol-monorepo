import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { WalletClient, WatchSigner } from '../src'

const testAddress = '0x4a662a70184c9e8f62e9d298c9969318a74cec5e9d3b5e0616a687052e654e57'
const suilendCreateMock = vi.fn()

vi.mock('../src/modules/lendingModule/protocols/suilend', () => ({
  default: {
    create: suilendCreateMock
  }
}))

function createWalletClient(configs?: ConstructorParameters<typeof WalletClient>[0]['configs']) {
  return new WalletClient({
    signer: new WatchSigner(testAddress),
    client: {
      url: getJsonRpcFullnodeUrl('mainnet')
    },
    configs
  })
}

describe('lending protocol registry', () => {
  beforeEach(() => {
    suilendCreateMock.mockReset()
  })

  it('auto-loads the optional Suilend adapter by default to preserve v1 migration behavior', async () => {
    const walletClient = createWalletClient()
    suilendCreateMock.mockResolvedValueOnce({ name: 'suilend' })

    const navi = await walletClient.lending.getProtocol('navi')
    const suilend = await walletClient.lending.getProtocol('suilend')

    expect(navi?.name).toBe('navi')
    expect(suilend?.name).toBe('suilend')
    expect(suilendCreateMock).toHaveBeenCalledOnce()
  })

  it('keeps Suilend optional when explicitly disabled', async () => {
    const walletClient = createWalletClient({
      lending: {
        enableSuilend: false
      }
    })

    const navi = await walletClient.lending.getProtocol('navi')
    const suilend = await walletClient.lending.getProtocol('suilend')

    expect(navi?.name).toBe('navi')
    expect(suilend).toBeUndefined()
    expect(suilendCreateMock).not.toHaveBeenCalled()
  })

  it('warns and keeps Navi available when the optional Suilend adapter cannot initialize', async () => {
    const walletClient = createWalletClient()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = new Error('missing optional peer')
    suilendCreateMock.mockRejectedValueOnce(error)

    const navi = await walletClient.lending.getProtocol('navi')
    const suilend = await walletClient.lending.getProtocol('suilend')

    expect(navi?.name).toBe('navi')
    expect(suilend).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('Failed to initialize SuilendProtocol:', error)

    warnSpy.mockRestore()
  })
})
