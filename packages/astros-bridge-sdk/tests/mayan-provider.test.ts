import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mayanSdk = vi.hoisted(() => ({
  createSwapFromSuiMoveCalls: vi.fn(),
  swapFromSolana: vi.fn(),
  swapFromEvm: vi.fn()
}))

const ethersSdk = vi.hoisted(() => ({
  allowance: vi.fn(),
  approve: vi.fn(),
  parseUnits: vi.fn()
}))

vi.mock('@mayanfinance/swap-sdk', () => ({
  createSwapFromSuiMoveCalls: mayanSdk.createSwapFromSuiMoveCalls,
  swapFromSolana: mayanSdk.swapFromSolana,
  swapFromEvm: mayanSdk.swapFromEvm,
  addresses: {
    MAYAN_FORWARDER_CONTRACT: '0xforwarder'
  }
}))

vi.mock('ethers', () => ({
  Signer: class {},
  Overrides: class {},
  Contract: class {
    allowance = ethersSdk.allowance
    approve = ethersSdk.approve
  },
  parseUnits: ethersSdk.parseUnits
}))

function createMayanTransaction() {
  const tx = new Transaction()
  vi.spyOn(tx, 'setSenderIfNotSet')
  vi.spyOn(tx, 'setGasBudget')
  return tx
}

const signedBytes = 'AQID'

function createSuiCoreApi() {
  return {
    getMoveFunction: vi.fn(),
    getObjects: vi.fn(),
    getBalance: vi.fn(),
    listCoins: vi.fn(),
    getObject: vi.fn(),
    getCurrentSystemState: vi.fn(),
    getChainIdentifier: vi.fn(),
    simulateTransaction: vi.fn()
  }
}

async function createBuiltTransactionBytes() {
  const tx = new Transaction()
  tx.setSender(`0x${'1'.repeat(64)}`)
  tx.setGasBudget(1000)
  tx.setGasPrice(1000)
  tx.setGasPayment([
    {
      objectId: `0x${'2'.repeat(64)}`,
      version: '1',
      digest: '11111111111111111111111111111111'
    }
  ])
  return tx.build()
}

async function settleSwap<T>(promise: Promise<T>) {
  await vi.runAllTimersAsync()
  return promise
}

describe('mayan provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ethersSdk.parseUnits.mockImplementation((amount: string, decimals: number) => {
      const [whole, fraction = ''] = amount.split('.')
      return BigInt(`${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes the Sui adapter path through Mayan v2 transaction, sign, execute, and wait contracts', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'d'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'mainnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: {
          digest,
          status: {
            success: true,
            error: null
          }
        }
      })),
      waitForTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      }))
    }
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Transaction }) => {
      expect(transaction).toBeInstanceOf(Transaction)
      return {
        bytes: signedBytes,
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

    const resultPromise = swap(route as any, '0xfrom', '0xto', {
      sui: {
        provider: client as any,
        rpcUrl: 'https://custom.sui.rpc',
        gasBudget: 123456,
        signTransaction
      }
    })
    const result = await settleSwap(resultPromise)

    expect(result).toBe(digest)
    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      route.info_for_bridge,
      '0xfrom',
      '0xto',
      undefined,
      null,
      client
    )
    expect(mayanTx.setSenderIfNotSet).toHaveBeenCalledWith('0xfrom')
    expect(mayanTx.setGasBudget).toHaveBeenCalledWith(123456)
    expect(client.executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signed-signature'],
      include: {
        effects: true,
        events: true,
        balanceChanges: true
      }
    })
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest,
      include: {
        effects: true
      }
    })
  })

  it('rejects Sui source bridge before Mayan when the v2 Core API provider is incomplete', async () => {
    const { swap } = await import('../src/providers/mayan')
    const signTransaction = vi.fn()

    await expect(
      swap(
        {
          from_token: { chainId: 1999 },
          to_token: { chainId: 0 },
          info_for_bridge: { fromToken: { standard: 'sui' } }
        } as any,
        '0xfrom',
        '0xto',
        {
          sui: {
            provider: {
              network: 'mainnet',
              core: {
                getObject: vi.fn()
              },
              executeTransaction: vi.fn(),
              waitForTransaction: vi.fn()
            } as any,
            signTransaction
          }
        }
      )
    ).rejects.toThrow(
      'Sui bridge provider must implement the Sui SDK v2 Core API required by Transaction.build: missing core.getMoveFunction, core.getObjects, core.getBalance, core.listCoins, core.getCurrentSystemState, core.getChainIdentifier, core.simulateTransaction'
    )
    expect(mayanSdk.createSwapFromSuiMoveCalls).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('throws when the Sui source transaction reports a failed execution effect', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'e'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'mainnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        $kind: 'FailedTransaction',
        FailedTransaction: {
          digest,
          status: {
            success: false,
            error: 'MoveAbort(bridge)'
          }
        }
      })),
      waitForTransaction: vi.fn()
    }
    const signTransaction = vi.fn(async () => ({
      bytes: signedBytes,
      signature: 'signed-signature'
    }))

    await expect(
      swap(
        {
          from_token: { chainId: 1999 },
          to_token: { chainId: 0 },
          info_for_bridge: { fromToken: { standard: 'sui' } }
        } as any,
        '0xfrom',
        '0xto',
        {
          sui: {
            provider: client as any,
            signTransaction
          }
        }
      )
    ).rejects.toThrow('Sui bridge source transaction failed: MoveAbort(bridge)')
    expect(mayanTx.setGasBudget).not.toHaveBeenCalled()
    expect(client.waitForTransaction).not.toHaveBeenCalled()
  })

  it('keeps the Sui source path compatible when execution status is omitted', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'a'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'mainnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      })),
      waitForTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      }))
    }
    const signTransaction = vi.fn(async () => ({
      bytes: signedBytes,
      signature: 'signed-signature'
    }))

    const resultPromise = swap(
      {
        from_token: { chainId: 1999 },
        to_token: { chainId: 0 },
        info_for_bridge: { fromToken: { standard: 'sui' } }
      } as any,
      '0xfrom',
      '0xto',
      {
        sui: {
          provider: client as any,
          signTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe(digest)
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest,
      include: {
        effects: true
      }
    })
  })

  it('does not require rpcUrl when a v2 Sui provider is supplied', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'f'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'localnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: {
          digest,
          status: {
            success: true,
            error: null
          }
        }
      })),
      waitForTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      }))
    }
    const signTransaction = vi.fn(async () => ({
      bytes: signedBytes,
      signature: 'signed-signature'
    }))

    const resultPromise = swap(
      {
        from_token: { chainId: 1999 },
        to_token: { chainId: 0 },
        info_for_bridge: { fromToken: { standard: 'sui' } }
      } as any,
      '0xfrom',
      '0xto',
      {
        sui: {
          provider: client as any,
          signTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe(digest)
    expect(mayanTx.setGasBudget).not.toHaveBeenCalled()
    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      expect.anything(),
      '0xfrom',
      '0xto',
      undefined,
      null,
      client
    )
  })

  it('uses an explicit Sui build client for Mayan transaction construction while executing with the provider', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'b'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    const builtBytes = await createBuiltTransactionBytes()
    vi.spyOn(mayanTx, 'build').mockResolvedValueOnce(builtBytes)
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'mainnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: {
          digest,
          status: {
            success: true,
            error: null
          }
        }
      })),
      waitForTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      }))
    }
    const buildClient = {
      core: createSuiCoreApi()
    }
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Transaction }) => {
      expect(transaction).toBeInstanceOf(Transaction)
      expect(transaction).not.toBe(mayanTx)
      return {
        bytes: signedBytes,
        signature: 'signed-signature'
      }
    })

    const resultPromise = swap(
      {
        from_token: { chainId: 1999 },
        to_token: { chainId: 0 },
        info_for_bridge: { fromToken: { standard: 'sui' } }
      } as any,
      '0xfrom',
      '0xto',
      {
        sui: {
          provider: client as any,
          buildClient: buildClient as any,
          signTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe(digest)
    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      expect.anything(),
      '0xfrom',
      '0xto',
      undefined,
      null,
      buildClient
    )
    expect(mayanTx.build).toHaveBeenCalledWith({ client: buildClient })
    expect(client.executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signed-signature'],
      include: {
        effects: true,
        events: true,
        balanceChanges: true
      }
    })
  })

  it('normalizes flat Sui v2 execution responses before waiting by digest', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'c'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const client = {
      network: 'mainnet',
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({
        digest,
        status: {
          success: true,
          error: null
        }
      })),
      waitForTransaction: vi.fn(async () => ({
        $kind: 'Transaction',
        Transaction: { digest }
      }))
    }
    const signTransaction = vi.fn(async () => ({
      bytes: signedBytes,
      signature: 'signed-signature'
    }))

    const resultPromise = swap(
      {
        from_token: { chainId: 1999 },
        to_token: { chainId: 0 },
        info_for_bridge: { fromToken: { standard: 'sui' } }
      } as any,
      '0xfrom',
      '0xto',
      {
        sui: {
          provider: client as any,
          signTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe(digest)
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest,
      include: {
        effects: true
      }
    })
  })

  it('keeps Solana source routing on bridge API chain id 0', async () => {
    const { swap } = await import('../src/providers/mayan')
    mayanSdk.swapFromSolana.mockResolvedValueOnce({ signature: 'solana-signature' })
    const signTransaction = vi.fn()
    const connection = {}

    const resultPromise = swap(
      {
        from_token: { chainId: 0 },
        to_token: { chainId: 42161 },
        info_for_bridge: { fromToken: { standard: 'spl' } }
      } as any,
      'sol-from',
      '0xto',
      {
        solana: {
          signTransaction,
          connection: connection as any,
          extraRpcs: ['https://sol.rpc'],
          sendOptions: { skipPreflight: true } as any,
          jitoOptions: { tipLamports: 1000 } as any
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe('solana-signature')
    expect(mayanSdk.swapFromSolana).toHaveBeenCalledWith(
      { fromToken: { standard: 'spl' } },
      'sol-from',
      '0xto',
      undefined,
      signTransaction,
      connection,
      ['https://sol.rpc'],
      { skipPreflight: true },
      { tipLamports: 1000 }
    )
  })

  it('returns a Mayan gasless EVM order hash without waiting for it as an EVM transaction hash', async () => {
    const { swap } = await import('../src/providers/mayan')
    ethersSdk.allowance.mockResolvedValueOnce(1_000_000n)
    mayanSdk.swapFromEvm.mockResolvedValueOnce('mayan-order-hash')
    const waitForTransaction = vi.fn()

    const resultPromise = swap(
      {
        from_token: { chainId: 42161 },
        to_token: { chainId: 0 },
        info_for_bridge: {
          gasless: true,
          effectiveAmountIn: 0.6,
          effectiveAmountIn64: '600000',
          fromToken: {
            standard: 'erc20',
            decimals: 6,
            contract: '0xusdc'
          }
        }
      } as any,
      '0xfrom',
      'sol-to',
      {
        evm: {
          signer: {} as any,
          permit: undefined,
          overrides: undefined,
          waitForTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe('mayan-order-hash')
    expect(waitForTransaction).not.toHaveBeenCalled()
  })

  it('does not wait for Mayan gasless EVM object hashes as EVM transaction hashes', async () => {
    const { swap } = await import('../src/providers/mayan')
    ethersSdk.allowance.mockResolvedValueOnce(1_000_000n)
    mayanSdk.swapFromEvm.mockResolvedValueOnce({ hash: 'mayan-order-hash' })
    const waitForTransaction = vi.fn()

    const resultPromise = swap(
      {
        from_token: { chainId: 42161 },
        to_token: { chainId: 0 },
        info_for_bridge: {
          gasless: true,
          effectiveAmountIn: 0.6,
          effectiveAmountIn64: '600000',
          fromToken: {
            standard: 'erc20',
            decimals: 6,
            contract: '0xusdc'
          }
        }
      } as any,
      '0xfrom',
      'sol-to',
      {
        evm: {
          signer: {} as any,
          permit: undefined,
          overrides: undefined,
          waitForTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe('mayan-order-hash')
    expect(waitForTransaction).not.toHaveBeenCalled()
  })

  it('uses effectiveAmountIn64 for ERC20 allowance checks when Mayan provides base units', async () => {
    const { swap } = await import('../src/providers/mayan')
    ethersSdk.allowance.mockResolvedValueOnce(0n)
    const approveWait = vi.fn(async () => ({ status: 1 }))
    ethersSdk.approve.mockResolvedValueOnce({ wait: approveWait })
    mayanSdk.swapFromEvm.mockResolvedValueOnce({ hash: '0xevmhash' })
    const waitForTransaction = vi.fn(async () => undefined)

    const resultPromise = swap(
      {
        from_token: { chainId: 42161 },
        to_token: { chainId: 0 },
        info_for_bridge: {
          gasless: false,
          effectiveAmountIn: 0.6000000000001,
          effectiveAmountIn64: '600000',
          fromToken: {
            standard: 'erc20',
            decimals: 6,
            contract: '0xusdc'
          }
        }
      } as any,
      '0xfrom',
      'sol-to',
      {
        evm: {
          signer: {} as any,
          permit: null,
          overrides: null,
          waitForTransaction
        }
      }
    )
    const result = await settleSwap(resultPromise)

    expect(result).toBe('0xevmhash')
    expect(ethersSdk.parseUnits).not.toHaveBeenCalled()
    expect(ethersSdk.approve).toHaveBeenCalledWith('0xforwarder', 600000n)
    expect(waitForTransaction).toHaveBeenCalledWith({
      hash: '0xevmhash',
      confirmations: 3
    })
  })
})
