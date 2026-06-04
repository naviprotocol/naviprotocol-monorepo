import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it, vi } from 'vitest'

const legacySui = vi.hoisted(() => {
  const instances: Array<{ url: string }> = []
  return {
    instances,
    getFullnodeUrl: vi.fn((network: string) => `https://${network}.legacy.sui.invalid`),
    SuiClient: class {
      url: string

      constructor(options: { url: string }) {
        this.url = options.url
        instances.push(this)
      }
    }
  }
})

const mayanSdk = vi.hoisted(() => ({
  createSwapFromSuiMoveCalls: vi.fn(),
  swapFromSolana: vi.fn(),
  swapFromEvm: vi.fn()
}))

vi.mock('@mayanfinance/swap-sdk', () => ({
  createSwapFromSuiMoveCalls: mayanSdk.createSwapFromSuiMoveCalls,
  swapFromSolana: mayanSdk.swapFromSolana,
  swapFromEvm: mayanSdk.swapFromEvm,
  addresses: {
    MAYAN_FORWARDER_CONTRACT: '0xforwarder'
  }
}))

vi.mock('@mysten/sui-v1/client', () => ({
  SuiClient: legacySui.SuiClient,
  getFullnodeUrl: legacySui.getFullnodeUrl
}))

async function buildFixtureTransactionBytes() {
  const tx = new Transaction()
  tx.setSender(`0x${'1'.repeat(64)}`)
  tx.setGasBudget(1_000_000)
  tx.setGasPrice(1_000)
  tx.setGasPayment([
    {
      objectId: `0x${'2'.repeat(64)}`,
      version: '1',
      digest: '11111111111111111111111111111111'
    }
  ])
  return tx.build()
}

describe('mayan provider', () => {
  it('executes the Sui adapter path through legacy bytes, v2 sign, execute, and wait contracts', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'d'.repeat(64)}`
    const legacyBytes = await buildFixtureTransactionBytes()
    const legacyTx = {
      setSenderIfNotSet: vi.fn(),
      setGasBudget: vi.fn(),
      build: vi.fn(async () => legacyBytes)
    }
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(legacyTx)
    const client = {
      network: 'mainnet',
      executeTransactionBlock: vi.fn(async () => ({ digest })),
      waitForTransaction: vi.fn(async () => ({ digest }))
    }
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Transaction }) => {
      expect(transaction).toBeInstanceOf(Transaction)
      return {
        bytes: 'signed-bytes',
        signature: 'signed-signature'
      }
    })
    const route = {
      from_token: {
        chainId: 1999
      },
      to_token: {
        chainId: 0
      },
      info_for_bridge: {
        fromToken: {
          standard: 'sui'
        }
      }
    }

    const result = await swap(route as any, '0xfrom', '0xto', {
      sui: {
        provider: client as any,
        rpcUrl: 'https://custom.sui.rpc',
        gasBudget: 123456,
        signTransaction
      }
    })

    expect(result).toBe(digest)
    expect(legacySui.instances).toHaveLength(1)
    expect(legacySui.instances[0].url).toBe('https://custom.sui.rpc')
    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      route.info_for_bridge,
      '0xfrom',
      '0xto',
      undefined,
      null,
      legacySui.instances[0]
    )
    expect(legacyTx.setSenderIfNotSet).toHaveBeenCalledWith('0xfrom')
    expect(legacyTx.setGasBudget).toHaveBeenCalledWith(123456)
    expect(legacyTx.build).toHaveBeenCalledWith({ client: legacySui.instances[0] })
    expect(client.executeTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: 'signed-bytes',
      signature: ['signed-signature'],
      options: {
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true
      }
    })
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest
    })
  })
})
