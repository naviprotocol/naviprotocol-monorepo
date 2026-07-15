import { describe, expect, it, vi } from 'vitest'

const providerSwap = vi.fn(async () => '0xbridgeDigest')

vi.mock('../src/providers/mayan', () => ({
  swap: providerSwap
}))

const suiToken = {
  address: '0xsui',
  chainId: 1999,
  decimals: 9,
  logoURI: '',
  name: 'Sui',
  chainName: 'Sui',
  symbol: 'SUI',
  isSuggest: true,
  isVerify: true,
  category: []
}

const usdcToken = {
  address: 'sol-usdc',
  chainId: 1,
  decimals: 6,
  logoURI: '',
  name: 'USD Coin',
  chainName: 'Solana',
  symbol: 'USDC',
  isSuggest: true,
  isVerify: true,
  category: []
}

describe('bridge root swap', () => {
  it('lazy-loads the provider and returns a processing bridge transaction DTO', async () => {
    const { swap } = await import('../src')
    const quote = {
      provider: 'mayan',
      amount_in: '1000000000',
      amount_out: '995000',
      slippage_bps: 50,
      min_amount_out: '990000',
      from_token: suiToken,
      to_token: usdcToken,
      total_fee: '1000',
      spend_duration: 180,
      info_for_bridge: {
        fromToken: {
          standard: 'sui'
        }
      },
      path: []
    }
    const walletConnection = {
      sui: {
        provider: {} as any,
        signTransaction: vi.fn()
      }
    }

    const transaction = await swap(quote, '0xsender', 'sol-recipient', walletConnection)

    expect(providerSwap).toHaveBeenCalledWith(
      quote,
      '0xsender',
      'sol-recipient',
      walletConnection,
      undefined
    )
    expect(transaction).toMatchObject({
      id: '0xbridgeDigest',
      status: 'processing',
      sourceChainId: 1999,
      destChainId: 1,
      walletSourceAddress: '0xsender',
      walletDestAddress: 'sol-recipient',
      totalFeeAmount: '1000',
      bridgeFromAmount: '1000000000',
      bridgeToAmount: '995000',
      bridgeFeeAmount: '0',
      bridgeSourceTxHash: '0xbridgeDigest',
      bridgeDestTxHash: '',
      bridgeRefundTxHash: '',
      bridgeStatus: 'processing',
      bridgeProvider: 'mayan',
      bridgeFromToken: {
        address: '0xsui',
        symbol: 'SUI',
        decimals: 9
      },
      bridgeToToken: {
        address: 'sol-usdc',
        symbol: 'USDC',
        decimals: 6
      },
      hasSwap: false
    })
    expect(new Date(transaction.bridgeStartAt).toString()).not.toBe('Invalid Date')
    expect(new Date(transaction.bridgeEndAt ?? '').toString()).not.toBe('Invalid Date')
  })
})
