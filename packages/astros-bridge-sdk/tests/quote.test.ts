import { afterEach, describe, expect, it } from 'vitest'
import type { AxiosAdapter, AxiosResponse } from 'axios'
import { apiInstance } from '../src/config'
import { getQuote, getTransaction, getWalletTransactions } from '../src'

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

const originalAdapter = apiInstance.defaults.adapter

function jsonResponse(config: Parameters<AxiosAdapter>[0], data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config
  }
}

afterEach(() => {
  apiInstance.defaults.adapter = originalAdapter
})

describe('bridge API DTOs', () => {
  it('requests quotes with v2 token params and normalizes string chain ids', async () => {
    apiInstance.defaults.adapter = async (config) => {
      expect(config.url).toBe('/bridge-swap/find_routes')
      expect(config.params).toMatchObject({
        from: '0xsui',
        to: 'sol-usdc',
        fromChain: 1999,
        toChain: 1,
        amount: '1000000000',
        slippageBps: 50,
        referrerBps: 3
      })

      return jsonResponse(config, {
        data: {
          routes: [
            {
              provider: 'mayan',
              amount_in: '1000000000',
              amount_out: '995000',
              slippage_bps: 50,
              min_amount_out: '990000',
              from_token: {
                ...suiToken,
                chain: '1999',
                chainId: 0
              },
              to_token: {
                ...usdcToken,
                chain: '1',
                chainId: 0
              },
              total_fee: '1000',
              spend_duration: 180,
              info_for_bridge: {},
              path: []
            }
          ]
        }
      })
    }

    const result = await getQuote(suiToken, usdcToken, '1000000000', {
      slippageBps: 50,
      referrerBps: 3
    })

    expect(result.routes[0].from_token.chainId).toBe(1999)
    expect(result.routes[0].to_token.chainId).toBe(1)
  })

  it('maps transaction and wallet history status endpoints without mutating status values', async () => {
    const transaction = {
      id: '0xbridgeDigest',
      status: 'completed',
      lastUpdateAt: '2026-06-03T00:00:00.000Z',
      sourceChainId: 1999,
      destChainId: 1,
      walletSourceAddress: '0xsender',
      walletDestAddress: 'sol-recipient',
      totalFeeAmount: '1000',
      sourceToken: suiToken,
      destToken: usdcToken,
      hasSwap: false,
      bridgeProvider: 'mayan',
      bridgeStatus: 'completed',
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
      bridgeFromAmount: '1000000000',
      bridgeToAmount: '995000',
      bridgeStartAt: '2026-06-03T00:00:00.000Z',
      bridgeEndAt: '2026-06-03T00:03:00.000Z',
      bridgeFeeAmount: '0',
      bridgeSourceTxHash: '0xbridgeDigest',
      bridgeDestTxHash: 'sol-tx'
    }

    apiInstance.defaults.adapter = async (config) => {
      if (config.url === '/bridge-swap/transaction/0xbridgeDigest') {
        return jsonResponse(config, {
          data: {
            transaction
          }
        })
      }

      expect(config.url).toBe('/bridge-swap/transactions/list')
      expect(config.params).toMatchObject({
        address: '0xsender',
        page: 2,
        limit: 5
      })
      return jsonResponse(config, {
        data: {
          transactions: [transaction]
        }
      })
    }

    await expect(getTransaction('0xbridgeDigest')).resolves.toEqual(transaction)
    await expect(getWalletTransactions('0xsender', 2, 5)).resolves.toEqual({
      transactions: [transaction]
    })
  })
})
