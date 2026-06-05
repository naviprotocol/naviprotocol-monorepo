import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@mysten/sui-v1/client', () => ({
  SuiClient: legacySui.SuiClient,
  getFullnodeUrl: legacySui.getFullnodeUrl
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

async function settleSwap<T>(promise: Promise<T>) {
  await vi.runAllTimersAsync()
  return promise
}

describe('mayan provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    legacySui.instances.length = 0
    legacySui.getFullnodeUrl.mockImplementation(
      (network: string) => `https://${network}.legacy.sui.invalid`
    )
    ethersSdk.parseUnits.mockImplementation((amount: string, decimals: number) => {
      const [whole, fraction = ''] = amount.split('.')
      return BigInt(`${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('throws when the Sui source transaction reports a failed execution effect', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'e'.repeat(64)}`
    const legacyBytes = await buildFixtureTransactionBytes()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce({
      setSenderIfNotSet: vi.fn(),
      setGasBudget: vi.fn(),
      build: vi.fn(async () => legacyBytes)
    })
    const client = {
      network: 'mainnet',
      executeTransactionBlock: vi.fn(async () => ({
        digest,
        effects: {
          status: {
            status: 'failure',
            error: 'MoveAbort(bridge)'
          }
        }
      })),
      waitForTransaction: vi.fn()
    }
    const signTransaction = vi.fn(async () => ({
      bytes: 'signed-bytes',
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
    expect(client.waitForTransaction).not.toHaveBeenCalled()
  })

  it('uses the provider network to create the legacy Sui client when rpcUrl is omitted', async () => {
    const { swap } = await import('../src/providers/mayan')
    const digest = `0x${'f'.repeat(64)}`
    const legacyBytes = await buildFixtureTransactionBytes()
    mayanSdk.createSwapFromSuiMoveCalls.mockResolvedValueOnce({
      setSenderIfNotSet: vi.fn(),
      setGasBudget: vi.fn(),
      build: vi.fn(async () => legacyBytes)
    })
    const client = {
      network: 'testnet',
      executeTransactionBlock: vi.fn(async () => ({ digest })),
      waitForTransaction: vi.fn(async () => ({ digest }))
    }
    const signTransaction = vi.fn(async () => ({
      bytes: 'signed-bytes',
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
    expect(legacySui.getFullnodeUrl).toHaveBeenCalledWith('testnet')
    expect(legacySui.instances[0].url).toBe('https://testnet.legacy.sui.invalid')
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
