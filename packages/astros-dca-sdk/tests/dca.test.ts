import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { createDcaOrder, getCoinForDca, TimeUnit } from '../src'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

const userAddress = `0x${'1'.repeat(64)}`
const objectId = `0x${'2'.repeat(64)}`
const dcaOptions = {
  dcaContract: `0x${'3'.repeat(64)}`,
  dcaGlobalConfig: `0x${'4'.repeat(64)}`,
  dcaRegistry: `0x${'5'.repeat(64)}`
}

function createMockClient() {
  return {
    getCoinMetadata: vi.fn(async () => ({ decimals: 9 })),
    getCoins: vi.fn(async () => ({
      data: [
        {
          coinObjectId: objectId,
          balance: '1000'
        },
        {
          coinObjectId: `0x${'6'.repeat(64)}`,
          balance: '500'
        }
      ],
      nextCursor: null,
      hasNextPage: false
    }))
  } as unknown as SuiJsonRpcClient
}

describe('DCA PTB builders', () => {
  it('creates a SUI-funded DCA order without fetching owned coins', async () => {
    const client = createMockClient() as any
    const tx = await createDcaOrder(
      client,
      userAddress,
      {
        fromCoinType: '0x2::sui::SUI',
        toCoinType: '0x2::sui::SUI',
        depositedAmount: '100',
        frequency: { value: 1, unit: TimeUnit.HOUR },
        totalExecutions: 2
      },
      dcaOptions
    )

    const data = tx.getData() as any
    expect(client.getCoinMetadata).toHaveBeenCalledTimes(2)
    expect(client.getCoins).not.toHaveBeenCalled()
    expect(JSON.stringify(data)).toContain('"module":"order_registry"')
    expect(JSON.stringify(data)).toContain('"function":"create_order"')
  })

  it('merges and splits non-SUI coins for DCA funding', async () => {
    const client = createMockClient() as any
    const tx = new Transaction()

    await getCoinForDca(client, tx, userAddress, '0x2::test::COIN', 100)

    const data = tx.getData() as any
    expect(client.getCoins).toHaveBeenCalledWith({
      owner: userAddress,
      coinType: '0x2::test::COIN',
      cursor: null,
      limit: 100
    })
    expect(JSON.stringify(data)).toContain('MergeCoins')
    expect(JSON.stringify(data)).toContain('SplitCoins')
  })
})
