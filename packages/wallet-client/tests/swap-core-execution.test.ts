import './fetch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'

vi.mock('@naviprotocol/astros-aggregator-sdk', () => ({
  buildSwapPTBFromQuote: vi.fn(async (_address: string, tx: Transaction) => tx.gas),
  Dex: {},
  FeeOption: {},
  generateRefId: vi.fn(() => 0),
  getQuote: vi.fn(async () => ({
    amount_out: '200'
  }))
}))

vi.mock('@naviprotocol/lending', async (importActual) => {
  const actual = await importActual<typeof import('@naviprotocol/lending')>()
  return {
    ...actual,
    mergeCoinsPTB: vi.fn((tx: Transaction) => tx.gas)
  }
})

vi.mock('shio-sdk', () => ({
  executeAuction: vi.fn(async () => undefined)
}))

const { WalletClient, WatchSigner } = await import('../src')
const { executeAuction } = await import('shio-sdk')

const address = `0x${'1'.repeat(64)}`

function createSwapClient() {
  const walletClient = new WalletClient({
    signer: new WatchSigner(address),
    configs: {
      balance: {
        disableCoinPolling: true
      }
    },
    client: {
      network: 'mainnet',
      grpc: {
        url: 'https://grpc.example'
      },
      legacyJsonRpc: {
        url: 'https://json-rpc.example'
      }
    }
  })
  const balanceModule = walletClient.module('balance') as any
  balanceModule.uninstall()
  balanceModule.waitForUpdate = vi.fn(async () => undefined)
  balanceModule.updatePortfolio = vi.fn(async () => undefined)
  Object.defineProperty(balanceModule, 'portfolio', {
    configurable: true,
    value: {
      getBalance: vi.fn(() => ({
        coins: []
      }))
    }
  })
  return walletClient
}

describe('SwapModule Core execution adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs Shio auction then executes signed swap bytes through core.executeTransaction', async () => {
    const walletClient = createSwapClient()
    vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(Uint8Array.from([1, 2, 3]) as any)
    vi.spyOn(walletClient.signer, 'signTransaction').mockResolvedValue({
      bytes: 'AQID',
      signature: 'signed-signature'
    })
    const executeTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xswap',
        effects: {
          status: {
            success: true
          }
        },
        events: [
          {
            eventType: '0x2::slippage::SwapEvent',
            json: {
              amount_out: '200'
            }
          }
        ],
        balanceChanges: [],
        objectChanges: []
      }
    }))
    ;(walletClient.client as any).core = {
      executeTransaction
    }
    const legacyExecute = vi.spyOn(
      walletClient.clientBundle.legacyJsonRpc!,
      'executeTransactionBlock'
    )

    const result = await walletClient
      .module('swap')
      .swap('0x2::sui::SUI', '0x2::test::COIN', 100, 0.01)

    expect(executeAuction).toHaveBeenCalledWith('AQID', ['signed-signature'])
    expect(executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signed-signature'],
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    expect(legacyExecute).not.toHaveBeenCalled()
    expect(result.kind).toBe('execute')
    expect(result.digest).toBe('0xswap')
    expect(result.events[0]).toMatchObject({
      type: '0x2::slippage::SwapEvent',
      parsedJson: {
        amount_out: '200'
      }
    })
    expect(walletClient.module('balance').updatePortfolio).toHaveBeenCalled()
  })
})
