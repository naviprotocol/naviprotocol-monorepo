import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { SuiPriceServiceConnection, SuiPythClient } from '../src/pyth'

describe('SuiPriceServiceConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes price IDs when fetching latest price feeds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.getAll('ids[]')).toEqual(['abc123'])
      return new Response(
        JSON.stringify([
          {
            id: 'abc123',
            price: {
              price: '100',
              conf: '1',
              expo: -8,
              publish_time: 123
            }
          }
        ])
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const connection = new SuiPriceServiceConnection('https://hermes.pyth.network/')
    const feeds = await connection.getLatestPriceFeeds(['0xabc123'])

    expect(feeds?.[0].id).toBe('abc123')
    expect(feeds?.[0].getPriceUnchecked().publishTime).toBe(123)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('decodes VAA update data from Hermes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([btoa(String.fromCharCode(1, 2, 3))])))
    )

    const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
    const [vaa] = await connection.getPriceFeedsUpdateData(['abc123'])

    expect(Array.from(vaa)).toEqual([1, 2, 3])
  })
})

describe('SuiPythClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds v2 price update PTB from Hermes update data with dynamic package ids, base fee, and price table lookup', async () => {
    const pythStateId = `0x${'1'.repeat(64)}`
    const wormholeStateId = `0x${'2'.repeat(64)}`
    const pythPackageId = `0x${'3'.repeat(64)}`
    const wormholePackageId = `0x${'4'.repeat(64)}`
    const priceTableId = `0x${'5'.repeat(64)}`
    const priceInfoObjectId = `0x${'6'.repeat(64)}`
    const feedId = `0x${'a'.repeat(64)}`
    const accumulatorMessage = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3])
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/api/latest_vaas')
      expect(url.searchParams.getAll('ids[]')).toEqual(['a'.repeat(64)])
      return new Response(
        JSON.stringify([btoa(String.fromCharCode(...Array.from(accumulatorMessage)))])
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = {
      getObject: vi.fn(async ({ id }: { id: string }) => {
        if (id === pythStateId) {
          return {
            data: {
              content: {
                dataType: 'moveObject',
                fields: {
                  base_update_fee: '7',
                  upgrade_cap: {
                    fields: {
                      package: pythPackageId
                    }
                  }
                }
              }
            }
          }
        }

        if (id === wormholeStateId) {
          return {
            data: {
              content: {
                dataType: 'moveObject',
                fields: {
                  upgrade_cap: {
                    fields: {
                      package: wormholePackageId
                    }
                  }
                }
              }
            }
          }
        }

        throw new Error(`unexpected object id ${id}`)
      }),
      getDynamicFieldObject: vi.fn(async ({ parentId, name }: { parentId: string; name: any }) => {
        if (parentId === pythStateId) {
          expect(name).toEqual({
            type: 'vector<u8>',
            value: 'price_info'
          })
          return {
            data: {
              objectId: priceTableId,
              type: `0x2::table::Table<${pythPackageId}::price_identifier::PriceIdentifier, 0x2::object::ID>`
            }
          }
        }

        if (parentId === priceTableId) {
          expect(name.type).toBe(`${pythPackageId}::price_identifier::PriceIdentifier`)
          expect(name.value.bytes).toEqual(Array.from(Uint8Array.from({ length: 32 }, () => 0xaa)))
          return {
            data: {
              content: {
                dataType: 'moveObject',
                fields: {
                  value: priceInfoObjectId
                }
              }
            }
          }
        }

        throw new Error(`unexpected dynamic field parent ${parentId}`)
      })
    }

    const tx = new Transaction()
    const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
    const updates = await connection.getPriceFeedsUpdateData([feedId])
    const client = new SuiPythClient(provider as any, pythStateId, wormholeStateId)
    const updatedObjects = await client.updatePriceFeeds(tx, updates, [feedId])
    const commands = tx.getData().commands
    const moveCalls = commands.map((command: any) => command.MoveCall).filter(Boolean)
    const splitCoinCommands = commands.map((command: any) => command.SplitCoins).filter(Boolean)

    expect(updatedObjects).toEqual([priceInfoObjectId])
    expect(provider.getObject).toHaveBeenCalledWith({
      id: pythStateId,
      options: { showContent: true }
    })
    expect(provider.getObject).toHaveBeenCalledWith({
      id: wormholeStateId,
      options: { showContent: true }
    })
    expect(moveCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'vaa',
          function: 'parse_and_verify'
        }),
        expect.objectContaining({
          module: 'pyth',
          function: 'create_authenticated_price_infos_using_accumulator'
        }),
        expect.objectContaining({
          module: 'pyth',
          function: 'update_single_price_feed'
        }),
        expect.objectContaining({
          module: 'hot_potato_vector',
          function: 'destroy'
        })
      ])
    )
    expect(JSON.stringify(commands)).toContain(wormholePackageId)
    expect(JSON.stringify(commands)).toContain(pythPackageId)
    expect(splitCoinCommands).toHaveLength(1)
    expect(splitCoinCommands[0].amounts).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
