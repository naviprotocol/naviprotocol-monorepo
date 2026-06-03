import { describe, expect, it, vi } from 'vitest'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { WalletClient, WatchSigner } from '../src'

const testAddress = '0x4a662a70184c9e8f62e9d298c9969318a74cec5e9d3b5e0616a687052e654e57'

function createWalletClient() {
  return new WalletClient({
    signer: new WatchSigner(testAddress),
    client: {
      url: getJsonRpcFullnodeUrl('mainnet')
    }
  })
}

describe('lending protocol registry', () => {
  it('does not auto-load the legacy Suilend adapter by default', async () => {
    const walletClient = createWalletClient()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const navi = await walletClient.lending.getProtocol('navi')
    const suilend = await walletClient.lending.getProtocol('suilend')

    expect(navi?.name).toBe('navi')
    expect(suilend).toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialize SuilendProtocol'),
      expect.anything()
    )

    warnSpy.mockRestore()
  })
})
