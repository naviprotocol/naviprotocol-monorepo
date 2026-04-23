import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { Transaction } from '@mysten/sui/transactions'

import { getQuote } from '../src/astros-sdk'
import { buildSwapWithoutServiceFee } from '../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { buildSwapPTBFromQuote } from '../src/libs/Aggregator/swapPTB'
import { Dex, Quote } from '../src/types'

vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}))

vi.mock('../src/libs/Aggregator/buildSwapWithoutServiceFee', () => ({
  buildSwapWithoutServiceFee: vi.fn(async () => ({
    $kind: 'Result',
    Result: 0
  }))
}))

const axiosGetMock = vi.mocked(axios.get)
const buildSwapWithoutServiceFeeMock = vi.mocked(buildSwapWithoutServiceFee)

const fromCoinAddress =
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
const toCoinAddress = '0x2::sui::SUI'
const userAddress = `0x${'1'.repeat(64)}`

const baseQuote = {
  routes: [
    {
      amount_in: '1000000000'
    }
  ],
  amount_in: '1000000000',
  amount_out: '30243794847',
  from: fromCoinAddress,
  target: toCoinAddress,
  dexList: [Dex.CETUS],
  high_price_impact: false
} satisfies Quote

describe('aggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests quotes with provider filters and normalizes from/target', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        data: {
          ...baseQuote,
          from: '',
          target: ''
        }
      }
    } as never)

    const quote = await getQuote(fromCoinAddress, toCoinAddress, '1000000000', 'test-key', {
      dexList: [Dex.CETUS],
      byAmountIn: true,
      depth: 3
    })

    expect(axiosGetMock).toHaveBeenCalledTimes(1)
    const [url, config] = axiosGetMock.mock.calls[0]
    expect(url).toContain('from=')
    expect(url).toContain('target=')
    expect(url).toContain('amount=1000000000')
    expect(url).toContain('by_amount_in=true')
    expect(url).toContain('depth=3')
    expect(url).toContain('version=13')
    expect(url).toContain('providers=cetus')
    expect(config).toEqual({
      headers: {
        'x-navi-token': 'test-key'
      }
    })
    expect(quote.from).toBe(fromCoinAddress)
    expect(quote.target).toBe(toCoinAddress)
    expect(quote.amount_out).toBe(baseQuote.amount_out)
  })

  it('passes slippage-derived minAmountOut into buildSwapPTBFromQuote', async () => {
    const tx = new Transaction()
    const coinIn = tx.object(`0x${'2'.repeat(64)}`)

    await buildSwapPTBFromQuote(
      userAddress,
      tx,
      undefined,
      coinIn,
      baseQuote,
      7,
      false,
      undefined,
      {
        slippage: 0.01
      }
    )

    expect(buildSwapWithoutServiceFeeMock).toHaveBeenCalledTimes(1)
    expect(buildSwapWithoutServiceFeeMock).toHaveBeenCalledWith(
      userAddress,
      tx,
      coinIn,
      baseQuote,
      Math.round(Number(baseQuote.amount_out) * 0.99),
      7,
      false
    )
  })

  it('rejects quotes whose route amounts do not match the outer amount', async () => {
    const tx = new Transaction()

    await expect(
      buildSwapPTBFromQuote(
        userAddress,
        tx,
        1,
        tx.object(`0x${'3'.repeat(64)}`),
        {
          ...baseQuote,
          routes: [
            {
              amount_in: '999999999'
            }
          ]
        },
        0,
        false
      )
    ).rejects.toThrow('Outer amount_in does not match the sum of route amount_in values')
  })
})
