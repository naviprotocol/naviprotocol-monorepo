import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mayanSdk = vi.hoisted(() => ({
  createSwapFromSuiMoveCalls: vi.fn(),
  getSwapSui: vi.fn(),
  addInitOrderMoveCalls: vi.fn(),
  addBridgeLockedFeeMoveCalls: vi.fn(),
  addBridgeWithFeeMoveCalls: vi.fn(),
  addFastMctpBridgeMoveCalls: vi.fn(),
  addFastMctpCreateOrderMoveCalls: vi.fn(),
  fetchMayanSuiPackageId: vi.fn(),
  getQuoteSuitableReferrerAddress: vi.fn(),
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
  getSwapSui: mayanSdk.getSwapSui,
  addInitOrderMoveCalls: mayanSdk.addInitOrderMoveCalls,
  addBridgeLockedFeeMoveCalls: mayanSdk.addBridgeLockedFeeMoveCalls,
  addBridgeWithFeeMoveCalls: mayanSdk.addBridgeWithFeeMoveCalls,
  addFastMctpBridgeMoveCalls: mayanSdk.addFastMctpBridgeMoveCalls,
  addFastMctpCreateOrderMoveCalls: mayanSdk.addFastMctpCreateOrderMoveCalls,
  fetchMayanSuiPackageId: mayanSdk.fetchMayanSuiPackageId,
  getQuoteSuitableReferrerAddress: mayanSdk.getQuoteSuitableReferrerAddress,
  nativeAddressToHexString: () => `0x${'5'.repeat(64)}`,
  getWormholeChainIdByName: () => 30,
  resolveInputCoin: mayanSdk.resolveInputCoin,
  swapFromSolana: mayanSdk.swapFromSolana,
  swapFromEvm: mayanSdk.swapFromEvm,
  addresses: {
    MAYAN_FORWARDER_CONTRACT: '0xforwarder',
    SUI_MCTP_STATE: `0x${'6'.repeat(64)}`,
    SUI_MCTP_FEE_MANAGER_STATE: `0x${'7'.repeat(64)}`,
    SUI_FAST_MCTP_STATE: `0x${'a'.repeat(64)}`,
    SUI_LOGGER_PACKAGE_ID: `0x${'8'.repeat(64)}`
  }
}))

vi.mock('ethers', () => ({
  Signer: class {},
  Overrides: class {},
  Contract: class {
    allowance = ethersSdk.allowance
    approve = ethersSdk.approve
  },
  parseUnits: ethersSdk.parseUnits,
  ZeroAddress: '0x0000000000000000000000000000000000000000'
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

  function suiRoute(fromContract: string, type: 'MCTP' | 'FAST_MCTP') {
    return {
      from_token: { chainId: 1999 },
      to_token: { chainId: 8453 },
      info_for_bridge: {
        type,
        fromToken: { standard: 'suicoin', contract: fromContract },
        ...(type === 'MCTP'
          ? { mctpInputContract: SUI_USDC }
          : { fastMctpInputContract: SUI_USDC }),
        effectiveAmountIn64: '3000000000'
      }
    }
  }

  async function runSuiSwap(fromContract: string, type: 'MCTP' | 'FAST_MCTP' = 'MCTP') {
    const { swap } = await import('../src/providers/mayan')
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce(createMayanTransaction())
    const client = {
      core: createSuiCoreApi(),
      executeTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } })),
      waitForTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } }))
    }
    const signTransaction = vi.fn(async () => ({ bytes: signedBytes, signature: 'sig' }))
    await settleSwap(
      swap(suiRoute(fromContract, type) as any, '0xfrom', '0xto', {
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

  it('prepares a Fast MCTP SUI input from the gas coin too', async () => {
    const { options } = await runSuiSwap(
      '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
      'FAST_MCTP'
    )

    const [split] = options.builtTransaction.getData().commands
    expect(split.$kind).toBe('SplitCoins')
    expect(split.SplitCoins.coin).toEqual({ $kind: 'GasCoin', GasCoin: true })
    expect(mayanSdk.resolveInputCoin).not.toHaveBeenCalled()
  })

  it('selects a non-SUI Fast MCTP input locally through Mayan resolveInputCoin', async () => {
    const DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
    const coin = { $kind: 'Result', Result: 0 }
    mayanSdk.resolveInputCoin.mockResolvedValueOnce(coin)

    const { client, options } = await runSuiSwap(DEEP, 'FAST_MCTP')

    expect(mayanSdk.resolveInputCoin).toHaveBeenCalledWith(
      3000000000n,
      '0xfrom',
      DEEP,
      client,
      options.builtTransaction
    )
    expect(options.inputCoin).toEqual({ result: coin })
  })

  it('leaves a Fast MCTP USDC input to Mayan local coin selection', async () => {
    const { options } = await runSuiSwap(SUI_USDC, 'FAST_MCTP')

    expect(options).toBeUndefined()
    expect(mayanSdk.resolveInputCoin).not.toHaveBeenCalled()
  })
})

describe('mayan provider Sui pre-swap routing', () => {
  const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
  const SUI_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
  const REFERRERS = { sui: '0xsuiref', evm: '0xevmref', solana: 'solref' }
  const digest = `0x${'d'.repeat(64)}`
  const MCTP_PACKAGE = `0x${'9'.repeat(64)}`
  const MIN_MIDDLE_ABORT = `Transaction resolution failed: MoveAbort in 12th command, abort code: 4, in '${MCTP_PACKAGE}::init_order::prepare_initialize_order' (instruction 7)`

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mayanSdk.getQuoteSuitableReferrerAddress.mockReturnValue('0xevmref')
    mayanSdk.fetchMayanSuiPackageId.mockResolvedValue(MCTP_PACKAGE)
    mayanSdk.getSwapSui.mockImplementation(async () => {
      const preSwap = new Transaction()
      preSwap.splitCoins(preSwap.gas, [1])
      preSwap.splitCoins(preSwap.gas, [2])
      return {
        tx: await preSwap.toJSON(),
        outCoin: { $kind: 'Result', Result: 0 },
        whFeeCoin: { $kind: 'Result', Result: 1 }
      }
    })
    vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function route(fromContract: string, overrides: Record<string, unknown> = {}) {
    return {
      from_token: { chainId: 1999 },
      to_token: { chainId: 8453 },
      info_for_bridge: {
        type: 'MCTP',
        fromChain: 'sui',
        toChain: 'base',
        hasAuction: true,
        cheaperChain: 'base',
        slippageBps: 50,
        referrerBps: 10,
        minMiddleAmount: 1.627692,
        deadline64: String(Math.floor(Date.now() / 1000) + 600),
        fromToken: {
          standard: 'suicoin',
          contract: fromContract,
          verifiedAddress: `0x${'4'.repeat(64)}`
        },
        mctpInputContract: SUI_USDC,
        effectiveAmountIn64: '1500000000',
        ...overrides
      }
    }
  }

  const simulated = (status: Record<string, unknown>) => ({
    $kind: 'Transaction',
    Transaction: { digest, status }
  })

  async function run(
    fromContract: string,
    simulations: Array<Record<string, unknown> | Error>,
    preswapRouting?: 'default' | 'mayan',
    referrers: typeof REFERRERS | undefined = REFERRERS,
    overrides: Record<string, unknown> = {}
  ) {
    const { swap } = await import('../src/providers/mayan')
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValue(createMayanTransaction())
    const core = createSuiCoreApi()
    for (const result of simulations) {
      if (result instanceof Error) core.simulateTransaction.mockRejectedValueOnce(result)
      else core.simulateTransaction.mockResolvedValueOnce(result)
    }
    const client = {
      core,
      executeTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } })),
      waitForTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } }))
    }
    const signTransaction = vi.fn(async () => ({ bytes: signedBytes, signature: 'sig' }))
    const promise = swap(
      route(fromContract, overrides) as any,
      '0xfrom',
      '0xto',
      { sui: { provider: client as any, signTransaction, preswapRouting } },
      referrers
    )
    promise.catch(() => undefined)
    return { promise: settleSwap(promise), client, signTransaction }
  }

  it('keeps the existing Mayan path when the routing option is not set', async () => {
    const { promise, client } = await run(SUI, [])
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      expect.anything(),
      '0xfrom',
      '0xto',
      REFERRERS,
      null,
      client,
      expect.objectContaining({ builtTransaction: expect.any(Transaction) })
    )
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
    expect(client.core.simulateTransaction).not.toHaveBeenCalled()
  })

  it('requests the pre-swap without the referrer and keeps the referrer on the order', async () => {
    const { promise, client, signTransaction } = await run(
      SUI,
      [simulated({ success: true })],
      'mayan'
    )
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).not.toHaveBeenCalled()
    const [request] = mayanSdk.getSwapSui.mock.calls[0]
    expect(request).not.toHaveProperty('referrerAddress')
    expect(request).toMatchObject({
      amountIn64: '1500000000',
      inputCoinType: SUI,
      middleCoinType: SUI_USDC,
      userWallet: '0xfrom',
      withWhFee: true,
      slippageBps: 50,
      chainName: 'sui'
    })
    expect(request.inputCoin.result).toMatchObject({ $kind: 'NestedResult' })

    const [quote, , , referrer, , , , options] = mayanSdk.addInitOrderMoveCalls.mock.calls[0]
    expect(referrer).toBe('0xevmref')
    expect(quote.minMiddleAmount).toBe(1.627692)
    expect(quote.referrerBps).toBe(10)
    expect(options.inputCoin).toEqual({ result: { $kind: 'Result', Result: 0 } })
    expect(options.whFeeCoin).toEqual({ result: { $kind: 'Result', Result: 1 } })
    expect(client.core.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(signTransaction).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['sui', 'addBridgeLockedFeeMoveCalls', false],
    ['base', 'addBridgeWithFeeMoveCalls', true]
  ] as const)(
    'requests a non-auction pre-swap without the referrer and keeps the %s-cheaper bridge call',
    async (cheaperChain, bridgeCall, withWhFee) => {
      const { promise, client } = await run(
        SUI,
        [simulated({ success: true })],
        'mayan',
        REFERRERS,
        {
          hasAuction: false,
          cheaperChain
        }
      )
      await promise

      expect(mayanSdk.createSwapFromSuiMoveCalls).not.toHaveBeenCalled()
      const [request] = mayanSdk.getSwapSui.mock.calls[0]
      expect(request).not.toHaveProperty('referrerAddress')
      expect(request.withWhFee).toBe(withWhFee)
      expect(mayanSdk.addInitOrderMoveCalls).not.toHaveBeenCalled()
      expect(mayanSdk[bridgeCall]).toHaveBeenCalledTimes(1)
      expect(mayanSdk[bridgeCall].mock.calls[0][0].minMiddleAmount).toBe(1.627692)
      expect(client.core.simulateTransaction).toHaveBeenCalledTimes(1)
    }
  )

  it('rebuilds from the same quote when the pre-swap misses the order minimum', async () => {
    const { promise, signTransaction } = await run(
      SUI,
      [
        simulated({ success: false, error: { message: MIN_MIDDLE_ABORT } }),
        simulated({ success: true })
      ],
      'mayan'
    )
    await promise

    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(2)
    for (const [quote] of mayanSdk.addInitOrderMoveCalls.mock.calls) {
      expect(quote.minMiddleAmount).toBe(1.627692)
    }
    expect(signTransaction).toHaveBeenCalledTimes(1)
  })

  it('retries a malformed pre-swap transaction thrown during resolution', async () => {
    const { promise } = await run(
      SUI,
      [
        new Error('CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue } in command 1'),
        simulated({ success: true })
      ],
      'mayan'
    )
    await promise

    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(2)
  })

  it('does not retry a missing argument outside the pre-swap Mayan returned', async () => {
    const { promise, signTransaction } = await run(
      SUI,
      [new Error('CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue } in command 5')],
      'mayan'
    )

    await expect(promise).rejects.toThrow('in command 5')
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(1)
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('does not retry an abort code 4 from another package', async () => {
    const other = MIN_MIDDLE_ABORT.replace(MCTP_PACKAGE, `0x${'3'.repeat(64)}`)
    const { promise } = await run(
      SUI,
      [simulated({ success: false, error: { message: other } })],
      'mayan'
    )

    await expect(promise).rejects.toThrow('abort code: 4')
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(1)
  })

  it('asks for a fresh quote once the quote deadline has passed, without building', async () => {
    const { promise, signTransaction } = await run(SUI, [], 'mayan', REFERRERS, {
      deadline64: String(Math.floor(Date.now() / 1000) - 1)
    })

    await expect(promise).rejects.toMatchObject({ code: 'BRIDGE_QUOTE_EXPIRED' })
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('checks the quote deadline again after the final build, before the wallet', async () => {
    const { swap } = await import('../src/providers/mayan')
    const core = createSuiCoreApi()
    core.simulateTransaction.mockResolvedValueOnce(simulated({ success: true }))
    const client = {
      core,
      executeTransaction: vi.fn(),
      waitForTransaction: vi.fn()
    }
    const deadline = Math.floor(Date.now() / 1000) + 600
    const buildClient = { core: createSuiCoreApi() }
    // The simulated build passes; the separate build client's final conversion build, after
    // simulation, crosses the quote deadline.
    let builds = 0
    vi.mocked(Transaction.prototype.build).mockImplementation(async (options?: any) => {
      if (options?.client === buildClient && ++builds === 2) vi.setSystemTime((deadline + 1) * 1000)
      return new Uint8Array([1, 2, 3])
    })
    vi.spyOn(Transaction, 'from').mockReturnValue(new Transaction())
    const signTransaction = vi.fn(async () => ({ bytes: signedBytes, signature: 'sig' }))
    const promise = swap(
      route(SUI, { deadline64: String(deadline) }) as any,
      '0xfrom',
      '0xto',
      {
        sui: {
          provider: client as any,
          buildClient: buildClient as any,
          signTransaction,
          preswapRouting: 'mayan'
        }
      },
      REFERRERS
    )
    promise.catch(() => undefined)

    await expect(settleSwap(promise)).rejects.toMatchObject({ code: 'BRIDGE_QUOTE_EXPIRED' })
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('asks for a fresh quote after three builds miss the order minimum, without signing', async () => {
    const miss = simulated({ success: false, error: { message: MIN_MIDDLE_ABORT } })
    const { promise, signTransaction } = await run(SUI, [miss, miss, miss], 'mayan')

    await expect(promise).rejects.toMatchObject({ code: 'BRIDGE_QUOTE_EXPIRED' })
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(3)
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('surfaces other simulation failures immediately', async () => {
    const { promise, signTransaction } = await run(
      SUI,
      [simulated({ success: false, error: { message: 'InsufficientCoinBalance in command 0' } })],
      'mayan'
    )

    await expect(promise).rejects.toThrow('InsufficientCoinBalance')
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(1)
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('keeps the existing path for a USDC source, which has no pre-swap', async () => {
    const { promise, client } = await run(SUI_USDC, [], 'mayan')
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledTimes(1)
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
    expect(client.core.simulateTransaction).not.toHaveBeenCalled()
  })

  it('keeps the existing path when no referrer applies', async () => {
    mayanSdk.getQuoteSuitableReferrerAddress.mockReturnValue(null)
    const { promise } = await run(SUI, [], 'mayan', undefined)
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledTimes(1)
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
  })
})

describe('mayan provider Sui Fast MCTP pre-swap routing', () => {
  const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
  const SUI_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
  const REFERRERS = { sui: '0xsuiref', evm: '0xevmref', solana: 'solref' }
  const digest = `0x${'d'.repeat(64)}`
  const FAST_PACKAGE = `0x${'b'.repeat(64)}`
  const MCTP_PACKAGE = `0x${'9'.repeat(64)}`
  const SUI_CURRENCY = `0x${'c'.repeat(64)}`
  const FROM = `0x${'f'.repeat(64)}`
  const abort = (pkg: string, location: string, code: number) =>
    `Transaction resolution failed: MoveAbort in 11th command, abort code: ${code}, in '${pkg}::${location}' (instruction 7)`
  const BRIDGE_MISS = abort(FAST_PACKAGE, 'bridge::prepare_bridge', 1)
  const ORDER_MISS = abort(FAST_PACKAGE, 'create_order::prepare_create_order', 1)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mayanSdk.getQuoteSuitableReferrerAddress.mockReturnValue('0xevmref')
    mayanSdk.fetchMayanSuiPackageId.mockImplementation(async (state: string) =>
      state === `0x${'a'.repeat(64)}` ? FAST_PACKAGE : MCTP_PACKAGE
    )
    mayanSdk.getSwapSui.mockImplementation(async () => {
      const preSwap = new Transaction()
      preSwap.splitCoins(preSwap.gas, [1])
      preSwap.splitCoins(preSwap.gas, [2])
      return {
        tx: await preSwap.toJSON(),
        outCoin: { $kind: 'Result', Result: 0 }
      }
    })
    vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function route(fromContract: string, overrides: Record<string, unknown> = {}) {
    return {
      from_token: { chainId: 1999 },
      to_token: { chainId: 8453 },
      info_for_bridge: {
        type: 'FAST_MCTP',
        fromChain: 'sui',
        toChain: 'base',
        hasAuction: false,
        slippageBps: 50,
        referrerBps: 10,
        minMiddleAmount: 4.967281,
        deadline64: String(Math.floor(Date.now() / 1000) + 600),
        fromToken: { standard: 'suicoin', contract: fromContract, currencyId: SUI_CURRENCY },
        fastMctpInputContract: SUI_USDC,
        fastMctpInputCurrencyId: `0x${'e'.repeat(64)}`,
        effectiveAmountIn64: '5000000000',
        ...overrides
      }
    }
  }

  const simulated = (status: Record<string, unknown>) => ({
    $kind: 'Transaction',
    Transaction: { digest, status }
  })

  async function run(
    fromContract: string,
    simulations: Array<Record<string, unknown> | Error>,
    overrides: Record<string, unknown> = {},
    toAddress = '0xto'
  ) {
    const { swap } = await import('../src/providers/mayan')
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValue(createMayanTransaction())
    const core = createSuiCoreApi()
    for (const result of simulations) {
      if (result instanceof Error) core.simulateTransaction.mockRejectedValueOnce(result)
      else core.simulateTransaction.mockResolvedValueOnce(result)
    }
    const client = {
      core,
      executeTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } })),
      waitForTransaction: vi.fn(async () => ({ $kind: 'Transaction', Transaction: { digest } }))
    }
    const signTransaction = vi.fn(async () => ({ bytes: signedBytes, signature: 'sig' }))
    const promise = swap(
      route(fromContract, overrides) as any,
      FROM,
      toAddress,
      { sui: { provider: client as any, signTransaction, preswapRouting: 'mayan' } },
      REFERRERS
    )
    promise.catch(() => undefined)
    return { promise: settleSwap(promise), client, signTransaction }
  }

  function lastOptions(call: typeof mayanSdk.addFastMctpBridgeMoveCalls) {
    const args = call.mock.calls[call.mock.calls.length - 1]
    return args[args.length - 1]
  }

  it('requests the pre-swap without the referrer and keeps the referrer on a Fast MCTP bridge', async () => {
    const { promise, client, signTransaction } = await run(SUI, [simulated({ success: true })])
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).not.toHaveBeenCalled()
    expect(mayanSdk.fetchMayanSuiPackageId).toHaveBeenCalledWith(`0x${'a'.repeat(64)}`, client)
    const [request] = mayanSdk.getSwapSui.mock.calls[0]
    expect(request).not.toHaveProperty('referrerAddress')
    expect(request).toMatchObject({
      amountIn64: '5000000000',
      inputCoinType: SUI,
      middleCoinType: SUI_USDC,
      userWallet: FROM,
      withWhFee: false,
      slippageBps: 50,
      chainName: 'sui'
    })
    expect(request.inputCoin.result).toMatchObject({ $kind: 'NestedResult' })

    expect(mayanSdk.addFastMctpCreateOrderMoveCalls).not.toHaveBeenCalled()
    const [quote, swapper, destination, referrer, packageId, payload, buildClient, options] =
      mayanSdk.addFastMctpBridgeMoveCalls.mock.calls[0]
    expect(quote.minMiddleAmount).toBe(4.967281)
    expect(quote.referrerBps).toBe(10)
    expect([swapper, destination, referrer, packageId, payload, buildClient]).toEqual([
      FROM,
      '0xto',
      '0xevmref',
      FAST_PACKAGE,
      null,
      client
    ])
    expect(options.inputCoin).toEqual({ result: { $kind: 'Result', Result: 0 } })

    const calls = (options.builtTransaction as Transaction)
      .getData()
      .commands.filter((command) => command.$kind === 'MoveCall')
      .map((command) => command.MoveCall!)
    expect(calls.map((call) => `${call.module}::${call.function}`)).toEqual([
      'bridge::log_initialize_fast_mctp'
    ])
    expect(calls[0].package).toBe(FAST_PACKAGE)
    expect(calls[0].typeArguments).toEqual([SUI])
    expect(mayanSdk.addInitOrderMoveCalls).not.toHaveBeenCalled()
    expect(client.core.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(signTransaction).toHaveBeenCalledTimes(1)
  })

  it('keeps the referrer on a Fast MCTP auction order', async () => {
    const { promise } = await run(SUI, [simulated({ success: true })], { hasAuction: true })
    await promise

    expect(mayanSdk.addFastMctpBridgeMoveCalls).not.toHaveBeenCalled()
    const [, swapper, destination, referrer, packageId] =
      mayanSdk.addFastMctpCreateOrderMoveCalls.mock.calls[0]
    expect([swapper, destination, referrer, packageId]).toEqual([
      FROM,
      '0xto',
      '0xevmref',
      FAST_PACKAGE
    ])
    const [request] = mayanSdk.getSwapSui.mock.calls[0]
    expect(request).not.toHaveProperty('referrerAddress')
  })

  it.each([
    ['bridge', {}, BRIDGE_MISS],
    ['auction order', { hasAuction: true }, ORDER_MISS]
  ] as const)(
    'rebuilds a Fast MCTP %s from the same quote when the pre-swap misses the minimum',
    async (_, overrides, miss) => {
      const { promise, signTransaction } = await run(
        SUI,
        [simulated({ success: false, error: { message: miss } }), simulated({ success: true })],
        overrides
      )
      await promise

      expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(2)
      expect(signTransaction).toHaveBeenCalledTimes(1)
    }
  )

  it('retries a malformed Fast MCTP pre-swap thrown during resolution', async () => {
    const { promise } = await run(SUI, [
      new Error('CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue } in command 1'),
      simulated({ success: true })
    ])
    await promise

    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['another package', abort(MCTP_PACKAGE, 'bridge::prepare_bridge', 1)],
    ['another function', abort(FAST_PACKAGE, 'bridge::bridge', 1)],
    ['another code', abort(FAST_PACKAGE, 'bridge::prepare_bridge', 2)],
    ['the MCTP minimum check', abort(FAST_PACKAGE, 'init_order::prepare_initialize_order', 4)]
  ])('does not retry a Fast MCTP abort from %s', async (_, message) => {
    const { promise, signTransaction } = await run(SUI, [
      simulated({ success: false, error: { message } })
    ])

    await expect(promise).rejects.toThrow('abort code')
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(1)
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('asks for a fresh quote after three Fast MCTP builds miss the minimum, without signing', async () => {
    const miss = simulated({ success: false, error: { message: BRIDGE_MISS } })
    const { promise, signTransaction } = await run(SUI, [miss, miss, miss])

    await expect(promise).rejects.toMatchObject({ code: 'BRIDGE_QUOTE_EXPIRED' })
    expect(mayanSdk.getSwapSui).toHaveBeenCalledTimes(3)
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('asks for a fresh Fast MCTP quote once its deadline has passed, without building', async () => {
    const { promise, signTransaction } = await run(SUI, [], {
      deadline64: String(Math.floor(Date.now() / 1000) - 1)
    })

    await expect(promise).rejects.toMatchObject({ code: 'BRIDGE_QUOTE_EXPIRED' })
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['the from token currency id', { fromToken: { standard: 'suicoin', contract: SUI } }],
    ['the input currency id', { fastMctpInputCurrencyId: undefined }]
  ])(
    'refuses a Fast MCTP quote without %s before requesting the pre-swap',
    async (_, overrides) => {
      const { promise, signTransaction } = await run(SUI, [], overrides)

      await expect(promise).rejects.toThrow('currency id is not provided')
      expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
      expect(signTransaction).not.toHaveBeenCalled()
    }
  )

  it('refuses a zero Fast MCTP destination before requesting the pre-swap', async () => {
    const { promise } = await run(SUI, [], {}, '0x0000000000000000000000000000000000000000')

    await expect(promise).rejects.toThrow('Invalid destination address for fast mctp')
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
  })

  it('keeps Mayan building a Fast MCTP USDC source, which has no pre-swap', async () => {
    const { promise, client } = await run(SUI_USDC, [])
    await promise

    expect(mayanSdk.createSwapFromSuiMoveCalls).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FAST_MCTP' }),
      FROM,
      '0xto',
      REFERRERS,
      null,
      client,
      undefined
    )
    expect(mayanSdk.getSwapSui).not.toHaveBeenCalled()
    expect(client.core.simulateTransaction).not.toHaveBeenCalled()
  })
})
