import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mayanSdk = vi.hoisted(() => ({
  createSwapFromSuiMoveCalls: vi.fn(),
  resolveInputCoin: vi.fn(),
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
  resolveInputCoin: mayanSdk.resolveInputCoin,
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
      client,
      undefined
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

  it('executes the Sui source path through core execution methods when no top-level methods are present', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'8'.repeat(64)}`
    const mayanTx = createMayanTransaction()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(mayanTx)
    const executeTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: {
        digest,
        status: {
          success: true,
          error: null
        }
      }
    }))
    const waitForTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: { digest }
    }))
    const client = {
      network: 'mainnet',
      core: {
        ...createSuiCoreApi(),
        executeTransaction,
        waitForTransaction
      }
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
    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      expect.anything(),
      '0xfrom',
      '0xto',
      undefined,
      null,
      client,
      undefined
    )
    expect(executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signed-signature'],
      include: {
        effects: true,
        events: true,
        balanceChanges: true
      }
    })
    expect(waitForTransaction).toHaveBeenCalledWith({
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

  it('throws when the Sui source transaction fails while waiting for finality', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'9'.repeat(64)}`
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
        Transaction: {
          digest,
          effects: {
            status: {
              status: 'failure',
              error: 'MoveAbort(wait)'
            }
          }
        }
      }))
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
    ).rejects.toThrow('Sui bridge source transaction failed: MoveAbort(wait)')
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest,
      include: {
        effects: true
      }
    })
  })

  it('throws when the Sui source transaction wait does not return final effects', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'7'.repeat(64)}`
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
      waitForTransaction: vi.fn(async () => undefined)
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
    ).rejects.toThrow('Sui bridge source transaction wait did not return final transaction effects')
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
      client,
      undefined
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
      buildClient,
      undefined
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

describe('mayan provider Sui pre-swap input', () => {
  const SUI_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
  const digest = `0x${'d'.repeat(64)}`

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function suiRoute(fromContract: string) {
    return {
      from_token: { chainId: 1999 },
      to_token: { chainId: 8453 },
      info_for_bridge: {
        type: 'MCTP',
        fromToken: { standard: 'suicoin', contract: fromContract },
        mctpInputContract: SUI_USDC,
        effectiveAmountIn64: '3000000000'
      }
    }
  }

  async function runSuiSwap(fromContract: string) {
    const { swap } = await import('../src/providers/mayan')
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(createMayanTransaction())
    const client = {
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } })),
      waitForTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } }))
    }
    const signTransaction = vi.fn(async () => ({ bytes: signedBytes, signature: 'sig' }))
    await settleSwap(
      swap(suiRoute(fromContract) as any, '0xfrom', '0xto', {
        sui: { provider: client as any, signTransaction }
      })
    )
    return { client, options: mayanSdk.createSwapFromSuiMoveCalls.mock.calls[0][6] }
  }

  it('splits a SUI input from the gas coin so Mayan never selects coins server-side', async () => {
    const { options } = await runSuiSwap(
      '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
    )

    expect(options.builtTransaction).toBeInstanceOf(Transaction)
    const [split] = options.builtTransaction.getData().commands
    expect(split.$kind).toBe('SplitCoins')
    expect(split.SplitCoins.coin).toEqual({ $kind: 'GasCoin', GasCoin: true })
    expect(options.inputCoin.result).toMatchObject({ $kind: 'NestedResult', NestedResult: [0, 0] })
    expect(mayanSdk.resolveInputCoin).not.toHaveBeenCalled()
  })

  it('selects a non-SUI input locally, including address balance, through Mayan resolveInputCoin', async () => {
    const DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
    const coin = { $kind: 'Result', Result: 0 }
    mayanSdk.resolveInputCoin.mockResolvedValueOnce(coin)

    const { client, options } = await runSuiSwap(DEEP)

    expect(mayanSdk.resolveInputCoin).toHaveBeenCalledWith(
      3000000000n,
      '0xfrom',
      DEEP,
      client,
      options.builtTransaction
    )
    expect(options.inputCoin).toEqual({ result: coin })
  })

  it('leaves a USDC input to Mayan local coin selection', async () => {
    const { options } = await runSuiSwap(SUI_USDC)

    expect(options).toBeUndefined()
    expect(mayanSdk.resolveInputCoin).not.toHaveBeenCalled()
  })
})
