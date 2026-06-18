import './fetch'
import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { WalletClient, WatchSigner } from '../src'

const address = `0x${'1'.repeat(64)}`

function createWalletClient() {
  return new WalletClient({
    signer: new WatchSigner(address),
    client: {
      url: 'https://json-rpc.example'
    }
  })
}

describe('WalletClient Core execution adapter', () => {
  it('dry-runs transactions through core.simulateTransaction when available', async () => {
    const walletClient = createWalletClient()
    const simulateTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xdry',
        status: {
          status: 'success'
        },
        events: [{ type: 'core::dry', json: { amount: '1' } }],
        balanceChanges: [],
        objectChanges: []
      }
    }))
    ;(walletClient.client as any).core = {
      simulateTransaction
    }
    const legacyDryRun = vi.spyOn(walletClient.client, 'dryRunTransactionBlock')
    const tx = new Transaction()

    const result = await walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: true
    })

    expect(simulateTransaction).toHaveBeenCalledWith({
      transaction: tx,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    expect(legacyDryRun).not.toHaveBeenCalled()
    expect(result.kind).toBe('dryRun')
    expect(result.digest).toBe('0xdry')
    expect(result.events).toEqual([
      { type: 'core::dry', json: { amount: '1' }, parsedJson: { amount: '1' } }
    ])
  })

  it('executes signed bytes through core.executeTransaction when available', async () => {
    const walletClient = createWalletClient()
    const tx = new Transaction()
    vi.spyOn(tx, 'build').mockResolvedValue(Uint8Array.from([1, 2, 3]))
    vi.spyOn(walletClient.signer, 'signTransaction').mockResolvedValue({
      bytes: 'AQID',
      signature: 'signed-signature'
    })
    const executeTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xexecute',
        status: {
          status: 'success'
        },
        events: [],
        balanceChanges: [],
        objectChanges: []
      }
    }))
    ;(walletClient.client as any).core = {
      executeTransaction
    }
    const legacyExecute = vi.spyOn(walletClient.client, 'signAndExecuteTransaction')

    const result = await walletClient.signExecuteTransaction({
      transaction: tx
    })

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
    expect(result.digest).toBe('0xexecute')
  })
})
