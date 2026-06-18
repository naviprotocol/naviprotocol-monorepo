import { describe, expect, it, vi } from 'vitest'
import {
  getAddressBalance,
  getCoinObjectOnlyBalance,
  listAddressBalances,
  normalizeAddressBalance
} from '../src/sui'
import type { CoinStruct } from '@mysten/sui/jsonRpc'

const NORMALIZED_SUI_COIN_TYPE =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'

describe('Address Balances', () => {
  it('normalizes non-zero addressBalance separately from coinBalance and total balance', async () => {
    const client = {
      core: {
        getBalance: vi.fn(async () => ({
          balance: {
            coinType: '0x2::sui::SUI',
            balance: '150',
            coinBalance: '100',
            addressBalance: '50',
            coinObjectCount: 2
          }
        })),
        listBalances: vi.fn(async () => ({
          balances: [
            {
              coinType: '0x2::sui::SUI',
              balance: '150',
              coinBalance: '100',
              addressBalance: '50',
              coinObjectCount: 2
            }
          ],
          nextCursor: null
        }))
      }
    }

    await expect(getAddressBalance(client, { owner: '0xowner' })).resolves.toEqual({
      coinType: NORMALIZED_SUI_COIN_TYPE,
      totalBalance: '150',
      coinBalance: '100',
      addressBalance: '50',
      coinObjectCount: 2
    })
    await expect(listAddressBalances(client, { owner: '0xowner' })).resolves.toEqual({
      balances: [
        {
          coinType: NORMALIZED_SUI_COIN_TYPE,
          totalBalance: '150',
          coinBalance: '100',
          addressBalance: '50',
          coinObjectCount: 2
        }
      ],
      nextCursor: null
    })
  })

  it('keeps coin-object-only balance distinct from total address balance', () => {
    const balance = normalizeAddressBalance({
      coinType: '0x2::sui::SUI',
      totalBalance: '150',
      fundsInAddressBalance: '50',
      coinObjectCount: 2
    })
    const coinObjectOnlyBalance = getCoinObjectOnlyBalance(
      [
        {
          coinType: '0x2::sui::SUI',
          balance: '40'
        },
        {
          coinType: '0x2::sui::SUI',
          balance: '60'
        }
      ] as CoinStruct[],
      '0x2::sui::SUI'
    )

    expect(balance).toEqual({
      coinType: NORMALIZED_SUI_COIN_TYPE,
      totalBalance: '150',
      coinBalance: '100',
      addressBalance: '50',
      coinObjectCount: 2
    })
    expect(coinObjectOnlyBalance).toBe('100')
    expect(coinObjectOnlyBalance).not.toBe(balance.totalBalance)
  })
})
