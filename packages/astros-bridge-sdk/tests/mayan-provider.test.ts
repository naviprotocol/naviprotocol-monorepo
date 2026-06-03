import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it, vi } from 'vitest'

const createSwapFromSuiMoveCalls = vi.fn(async () => new Transaction())

vi.mock('@mayanfinance/swap-sdk', () => ({
  createSwapFromSuiMoveCalls,
  swapFromSolana: vi.fn(),
  swapFromEvm: vi.fn(),
  addresses: {
    MAYAN_FORWARDER_CONTRACT: '0xforwarder'
  }
}))

describe('mayan provider', () => {
  it('executes the Sui adapter path through v2 sign, execute, and wait contracts', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'d'.repeat(64)}`
    const client = {
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
        signTransaction
      }
    })

    expect(result).toBe(digest)
    expect(createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      route.info_for_bridge,
      '0xfrom',
      '0xto',
      undefined,
      null,
      client
    )
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
