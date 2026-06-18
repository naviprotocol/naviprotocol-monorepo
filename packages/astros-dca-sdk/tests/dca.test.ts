import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import {
  cancelDcaOrder,
  createDcaOrder,
  dryRunDcaTransaction,
  getCoinForDca,
  TimeUnit
} from '../src'
import { getCoins } from '../src/libs/DCA/coinUtils'
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

  it('fetches paginated coins before returning DCA funding coins', async () => {
    const client = {
      getCoins: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              coinObjectId: objectId,
              balance: '1000'
            }
          ],
          nextCursor: 'cursor-1',
          hasNextPage: true
        })
        .mockResolvedValueOnce({
          data: [
            {
              coinObjectId: `0x${'6'.repeat(64)}`,
              balance: '500'
            }
          ],
          nextCursor: null,
          hasNextPage: false
        })
    } as unknown as SuiJsonRpcClient

    const coins = await getCoins(client, userAddress, '0x2::test::COIN')

    expect(coins.data).toHaveLength(2)
    expect(client.getCoins).toHaveBeenNthCalledWith(1, {
      owner: userAddress,
      coinType: '0x2::test::COIN',
      cursor: null,
      limit: 100
    })
    expect(client.getCoins).toHaveBeenNthCalledWith(2, {
      owner: userAddress,
      coinType: '0x2::test::COIN',
      cursor: 'cursor-1',
      limit: 100
    })
  })

  it('fetches paginated coins from Core API when the v2 client is available', async () => {
    const client = {
      core: {
        listCoins: vi
          .fn()
          .mockResolvedValueOnce({
            objects: [
              {
                coinObjectId: objectId,
                balance: '1000'
              }
            ],
            cursor: 'cursor-1',
            hasNextPage: true
          })
          .mockResolvedValueOnce({
            objects: [
              {
                coinObjectId: `0x${'6'.repeat(64)}`,
                balance: '500'
              }
            ],
            cursor: null,
            hasNextPage: false
          })
      },
      getCoins: vi.fn()
    }

    const coins = await getCoins(client as any, userAddress, '0x2::test::COIN')

    expect(coins.data).toHaveLength(2)
    expect(client.core.listCoins).toHaveBeenNthCalledWith(1, {
      owner: userAddress,
      coinType: '0x2::test::COIN',
      cursor: null,
      limit: 100
    })
    expect(client.core.listCoins).toHaveBeenNthCalledWith(2, {
      owner: userAddress,
      coinType: '0x2::test::COIN',
      cursor: 'cursor-1',
      limit: 100
    })
    expect(client.getCoins).not.toHaveBeenCalled()
  })

  it('rejects non-SUI DCA funding when balance is insufficient', async () => {
    const client = createMockClient() as any
    const tx = new Transaction()

    await expect(getCoinForDca(client, tx, userAddress, '0x2::test::COIN', 10_000)).rejects.toThrow(
      'Insufficient balance: need 10000, have 1500'
    )
  })

  it('creates a cancel DCA order PTB and transfers returned input coin', async () => {
    const receiptId = `0x${'7'.repeat(64)}`
    const tx = await cancelDcaOrder(
      {
        fromCoinType: '0x2::test::COIN',
        toCoinType: '0x2::sui::SUI'
      },
      receiptId,
      userAddress,
      dcaOptions
    )
    const data = tx.getData() as any

    expect(JSON.stringify(data)).toContain('"function":"cancel_order"')
    expect(JSON.stringify(data)).toContain('"function":"from_balance"')
    expect(JSON.stringify(data)).toContain('TransferObjects')
    expect(JSON.stringify(data)).toContain(dcaOptions.dcaContract)
    expect(JSON.stringify(data)).toContain(receiptId)
  })

  it('rejects cancel DCA order without receipt id', async () => {
    await expect(
      cancelDcaOrder(
        {
          fromCoinType: '0x2::test::COIN',
          toCoinType: '0x2::sui::SUI'
        },
        '',
        userAddress,
        dcaOptions
      )
    ).rejects.toThrow('receiptId is required')
  })

  it('dry-runs a DCA create transaction and normalizes the RPC response', async () => {
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
    const txBytes = Uint8Array.from([1, 3, 5])
    vi.spyOn(tx, 'build').mockResolvedValue(txBytes)
    const dryRunClient = {
      dryRunTransactionBlock: vi.fn(async () => ({
        effects: {
          status: {
            status: 'success'
          }
        },
        events: [
          {
            type: 'test::created'
          }
        ]
      }))
    }

    const result = await dryRunDcaTransaction(tx, {
      client: dryRunClient as any
    })

    expect(tx.build).toHaveBeenCalledWith({
      client: dryRunClient
    })
    expect(dryRunClient.dryRunTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: txBytes
    })
    expect(result.effects?.status?.status).toBe('success')
    expect(result.events).toEqual([
      {
        type: 'test::created'
      }
    ])
    expect(result.balanceChanges).toEqual([])
    expect(result.objectChanges).toEqual([])
  })

  it('dry-runs a DCA cancel transaction and normalizes empty RPC arrays', async () => {
    const tx = await cancelDcaOrder(
      {
        fromCoinType: '0x2::test::COIN',
        toCoinType: '0x2::sui::SUI'
      },
      `0x${'7'.repeat(64)}`,
      userAddress,
      dcaOptions
    )
    const txBytes = Uint8Array.from([2, 4, 6])
    vi.spyOn(tx, 'build').mockResolvedValue(txBytes)
    const dryRunClient = {
      dryRunTransactionBlock: vi.fn(async () => ({
        effects: {
          status: {
            status: 'success'
          }
        }
      }))
    }

    const result = await dryRunDcaTransaction(tx, {
      client: dryRunClient as any
    })

    expect(dryRunClient.dryRunTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: txBytes
    })
    expect(result.effects?.status?.status).toBe('success')
    expect(result.events).toEqual([])
    expect(result.balanceChanges).toEqual([])
    expect(result.objectChanges).toEqual([])
  })

  it('dry-runs a DCA transaction through Core API when the v2 client is available', async () => {
    const tx = await cancelDcaOrder(
      {
        fromCoinType: '0x2::test::COIN',
        toCoinType: '0x2::sui::SUI'
      },
      `0x${'7'.repeat(64)}`,
      userAddress,
      dcaOptions
    )
    const buildSpy = vi.spyOn(tx, 'build')
    const dryRunClient = {
      core: {
        simulateTransaction: vi.fn(async () => ({
          $kind: 'Transaction',
          Transaction: {
            effects: {
              status: {
                status: 'success'
              }
            },
            events: [{ type: 'core::dca' }],
            balanceChanges: [],
            objectChanges: []
          }
        }))
      },
      dryRunTransactionBlock: vi.fn()
    }

    const result = await dryRunDcaTransaction(tx, {
      client: dryRunClient as any
    })

    expect(buildSpy).not.toHaveBeenCalled()
    expect(dryRunClient.core.simulateTransaction).toHaveBeenCalledWith({
      transaction: tx,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    expect(dryRunClient.dryRunTransactionBlock).not.toHaveBeenCalled()
    expect(result.effects?.status?.status).toBe('success')
    expect(result.events).toEqual([{ type: 'core::dca' }])
  })
})
