import { describe, expect, it, vi, beforeEach } from 'vitest'

const suilend = vi.hoisted(() => ({
  initialize: vi.fn(),
  getObligationOwnerCaps: vi.fn(),
  grpcInstances: [] as Array<{ network: string; baseUrl: string }>
}))

vi.mock('@mysten/sui/grpc', () => ({
  SuiGrpcClient: class {
    network: string
    baseUrl: string

    constructor(options: { network: string; baseUrl: string }) {
      this.network = options.network
      this.baseUrl = options.baseUrl
      suilend.grpcInstances.push(this)
    }
  }
}))

vi.mock('@suilend/sdk/client', () => ({
  LENDING_MARKET_ID: 'market-id',
  LENDING_MARKET_TYPE: 'market-type',
  SuilendClient: {
    initialize: suilend.initialize,
    getObligationOwnerCaps: suilend.getObligationOwnerCaps
  }
}))

vi.mock('@suilend/sdk/parsers/obligation', () => ({
  parseObligation: vi.fn()
}))

vi.mock('@suilend/sdk/parsers/reserve', () => ({
  parseReserve: vi.fn()
}))

vi.mock('@suilend/sui-fe/lib/coinMetadata', () => ({
  getCoinMetadataMap: vi.fn()
}))

vi.mock('@suilend/sui-fe/lib/constants', () => ({
  MAX_U64: {
    toString: () => String(2n ** 64n - 1n)
  }
}))

describe('Suilend v3 adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suilend.grpcInstances.length = 0
    suilend.initialize.mockResolvedValue({ lendingMarket: { reserves: [] } })
    suilend.getObligationOwnerCaps.mockResolvedValue([
      { id: 'cap-id', obligationId: 'obligation-id' }
    ])
  })

  it('uses a SuiGrpcClient for Suilend v3 while keeping the adapter lazy', async () => {
    const { default: SuilendProtocol } = await import(
      '../src/modules/lendingModule/protocols/suilend'
    )
    const walletClient = {
      address: `0x${'1'.repeat(64)}`,
      client: {
        network: 'mainnet'
      },
      clientUrl: 'https://custom.sui.rpc'
    }

    await SuilendProtocol.create(walletClient as any)

    expect(suilend.grpcInstances).toEqual([
      {
        network: 'mainnet',
        baseUrl: 'https://custom.sui.rpc'
      }
    ])
    expect(suilend.initialize).toHaveBeenCalledWith(
      'market-id',
      'market-type',
      suilend.grpcInstances[0]
    )
    expect(suilend.getObligationOwnerCaps).toHaveBeenCalledWith(
      walletClient.address,
      ['market-type'],
      suilend.grpcInstances[0]
    )
  })

  it('uses an injected SuiGrpcClient when provided by module config', async () => {
    const { default: SuilendProtocol } = await import(
      '../src/modules/lendingModule/protocols/suilend'
    )
    const grpcClient = { network: 'mainnet', baseUrl: 'https://grpc.sui.invalid' }
    const walletClient = {
      address: `0x${'2'.repeat(64)}`,
      client: {
        network: 'mainnet'
      },
      clientUrl: 'https://json-rpc.sui.invalid'
    }

    await SuilendProtocol.create(walletClient as any, { grpcClient: grpcClient as any })

    expect(suilend.grpcInstances).toHaveLength(0)
    expect(suilend.initialize).toHaveBeenCalledWith('market-id', 'market-type', grpcClient)
    expect(suilend.getObligationOwnerCaps).toHaveBeenCalledWith(
      walletClient.address,
      ['market-type'],
      grpcClient
    )
  })
})
