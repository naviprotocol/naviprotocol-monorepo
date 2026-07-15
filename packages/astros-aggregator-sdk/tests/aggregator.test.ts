import './fetch'
import { describe, it, expect, vi } from 'vitest'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

import { buildSwapPTBFromQuote, getCoinPTB, swapPTB } from '../src/libs/Aggregator/swapPTB'
import { getQuote } from '../src/astros-sdk'
import { Dex } from '../src/types'

import { createTransaction, handleTransactionResult } from './helper'
import { keypair } from './keypair'
import dotenv from 'dotenv'

const { executeAuction } = vi.hoisted(() => ({
  executeAuction: vi.fn(async () => {
    throw new Error('shio unavailable in unit test')
  })
}))

vi.mock('shio-sdk', () => ({
  executeAuction
}))

vi.mock('../src/libs/Aggregator/getPositiveSlippageSetting', () => ({
  getRemotePositiveSlippageSetting: vi.fn(async () => false)
}))

dotenv.config()

const apiKey = process.env.API_KEY
const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

const coins = {
  sui: {
    address: '0x2::sui::SUI',
    holder: '0x80841329787fd577639add61cc955ace969af60fadfb05b8ff752c2de4a8aa65'
  },
  vSui: {
    address: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    holder: '0xb2630a7cdbe44adb2844b7715c7e6c54ec67e4558249deb71ba7b2df3c85915e'
  },
  haSui: {
    address: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    holder: '0xb2630a7cdbe44adb2844b7715c7e6c54ec67e4558249deb71ba7b2df3c85915e'
  },
  deep: {
    address: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    holder: '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
  }
}

describe('swap test', () => {
  it('builds a deterministic v2 PTB from a fixture quote', async () => {
    const userAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const txb = createTransaction(userAddress)
    const coinIn = txb.splitCoins(txb.gas, [1000n])
    const quote = {
      routes: [
        {
          amount_in: 1000,
          amount_out: 995,
          path: []
        }
      ],
      amount_in: '1000',
      amount_out: '995',
      from: coins.sui.address,
      target: coins.sui.address,
      dexList: [],
      high_price_impact: false
    }

    const coinOut = await buildSwapPTBFromQuote(
      userAddress,
      txb,
      undefined,
      coinIn,
      quote,
      0,
      false,
      undefined,
      { slippage: 0.01 }
    )

    const data = txb.getData()

    expect(coinOut).toBeDefined()
    expect(data.commands).toHaveLength(6)
    expect(data.commands[1]).toMatchObject({
      MoveCall: {
        module: 'coin',
        function: 'zero',
        typeArguments: [coins.sui.address]
      }
    })
    expect(data.commands[2]).toHaveProperty('SplitCoins')
    expect(data.commands[3]).toHaveProperty('MergeCoins')
    expect(data.commands[4]).toMatchObject({
      MoveCall: {
        module: 'coin_utils',
        function: 'transfer_nonzero',
        typeArguments: [coins.sui.address]
      }
    })
    expect(data.commands[5]).toMatchObject({
      MoveCall: {
        module: 'slippage',
        function: 'check_slippage_v3',
        typeArguments: [coins.sui.address, coins.sui.address]
      }
    })
  })

  it('rejects inconsistent route amount fixtures before building PTB', async () => {
    const txb = createTransaction(coins.sui.holder)
    const coinIn = txb.splitCoins(txb.gas, [1000n])
    const quote = {
      routes: [
        {
          amount_in: 999,
          amount_out: 995,
          path: []
        }
      ],
      amount_in: '1000',
      amount_out: '995',
      from: coins.sui.address,
      target: coins.sui.address,
      dexList: [],
      high_price_impact: false
    }

    await expect(
      buildSwapPTBFromQuote(coins.sui.holder, txb, 0, coinIn, quote, 0, false)
    ).rejects.toThrow('Outer amount_in does not match the sum of route amount_in values')
  })

  it('builds non-SUI coin inputs from Core API listCoins object ids', async () => {
    const userAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const txb = createTransaction(userAddress)
    const listCoins = vi.fn(async () => ({
      objects: [
        {
          objectId: `0x${'a'.repeat(64)}`,
          balance: '1000',
          coinType: coins.deep.address
        },
        {
          objectId: `0x${'b'.repeat(64)}`,
          balance: '1000',
          coinType: coins.deep.address
        }
      ],
      cursor: null,
      hasNextPage: false
    }))

    const coin = await getCoinPTB(userAddress, coins.deep.address, 100n, txb, {
      core: {
        listCoins
      }
    } as any)
    const commands = txb.getData().commands

    expect(coin).toBeDefined()
    expect(listCoins).toHaveBeenCalledWith({
      owner: userAddress,
      coinType: coins.deep.address,
      cursor: null,
      limit: 100
    })
    expect(commands[0]).toHaveProperty('MergeCoins')
    expect(commands[1]).toHaveProperty('SplitCoins')
  })

  it('paginates through Core API listCoins pages when selecting coin inputs', async () => {
    const userAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const txb = createTransaction(userAddress)
    const listCoins = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [
          {
            objectId: `0x${'a'.repeat(64)}`,
            balance: '1000',
            coinType: coins.deep.address
          }
        ],
        cursor: 'page-2',
        hasNextPage: true
      })
      .mockResolvedValueOnce({
        objects: [
          {
            objectId: `0x${'b'.repeat(64)}`,
            balance: '1000',
            coinType: coins.deep.address
          }
        ],
        cursor: null,
        hasNextPage: false
      })

    const coin = await getCoinPTB(userAddress, coins.deep.address, 100n, txb, {
      core: {
        listCoins
      }
    } as any)
    const commands = txb.getData().commands

    expect(coin).toBeDefined()
    expect(listCoins).toHaveBeenCalledTimes(2)
    expect(listCoins).toHaveBeenNthCalledWith(1, {
      owner: userAddress,
      coinType: coins.deep.address,
      cursor: null,
      limit: 100
    })
    expect(listCoins).toHaveBeenNthCalledWith(2, {
      owner: userAddress,
      coinType: coins.deep.address,
      cursor: 'page-2',
      limit: 100
    })
    expect(commands[0]).toHaveProperty('MergeCoins')
    expect(commands[1]).toHaveProperty('SplitCoins')
  })

  it('normalizes executeTransaction into a NAVI DTO even when shio auction fails', async () => {
    const { executeTransaction } = await import('../src/astros-sdk')
    const txb = createTransaction(coins.sui.holder)
    vi.spyOn(txb, 'build').mockResolvedValue(Uint8Array.from([1, 2, 3]))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const signer = {
      signTransaction: vi.fn(async () => ({
        bytes: 'signed-bytes',
        signature: 'signed-signature'
      }))
    }
    const client = {
      executeTransactionBlock: vi.fn(async () => ({
        digest: '0xabc',
        confirmedLocalExecution: true,
        timestampMs: '123',
        effects: {
          status: {
            status: 'success'
          }
        },
        events: [
          {
            type: 'test::event'
          }
        ],
        balanceChanges: [
          {
            owner: { AddressOwner: coins.sui.holder },
            amount: '-1',
            coinType: coins.sui.address
          }
        ],
        objectChanges: [
          {
            type: 'mutated',
            objectId: `0x${'8'.repeat(64)}`
          }
        ]
      }))
    }

    const result = await executeTransaction(txb, signer as any, {
      client: client as any
    })

    expect(consoleError).toHaveBeenCalled()
    expect(executeAuction).toHaveBeenCalledWith('signed-bytes', ['signed-signature'])
    expect(client.executeTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: 'signed-bytes',
      signature: ['signed-signature'],
      options: {
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true,
        showObjectChanges: true
      }
    })
    expect(result).toEqual({
      digest: '0xabc',
      confirmedLocalExecution: true,
      timestampMs: '123',
      effects: {
        status: {
          status: 'success'
        }
      },
      events: [
        {
          type: 'test::event'
        }
      ],
      balanceChanges: [
        {
          owner: { AddressOwner: coins.sui.holder },
          amount: '-1',
          coinType: coins.sui.address
        }
      ],
      objectChanges: [
        {
          type: 'mutated',
          objectId: `0x${'8'.repeat(64)}`
        }
      ],
      raw: {
        digest: '0xabc',
        confirmedLocalExecution: true,
        timestampMs: '123',
        effects: {
          status: {
            status: 'success'
          }
        },
        events: [
          {
            type: 'test::event'
          }
        ],
        balanceChanges: [
          {
            owner: { AddressOwner: coins.sui.holder },
            amount: '-1',
            coinType: coins.sui.address
          }
        ],
        objectChanges: [
          {
            type: 'mutated',
            objectId: `0x${'8'.repeat(64)}`
          }
        ]
      }
    })
    consoleError.mockRestore()
  })

  it('dry-runs a v2 swap PTB and normalizes the RPC response into a NAVI DTO', async () => {
    const { dryRunSwapTransaction } = await import('../src/astros-sdk')
    const txb = createTransaction(coins.sui.holder)
    const txBytes = Uint8Array.from([7, 8, 9])
    vi.spyOn(txb, 'build').mockResolvedValue(txBytes)
    const client = {
      dryRunTransactionBlock: vi.fn(async () => ({
        effects: {
          status: {
            status: 'success'
          }
        }
      }))
    }

    const result = await dryRunSwapTransaction(txb, {
      client: client as any
    })

    expect(txb.build).toHaveBeenCalledWith({
      client
    })
    expect(client.dryRunTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: txBytes
    })
    expect(result.effects?.status?.status).toBe('success')
    expect(result.events).toEqual([])
    expect(result.balanceChanges).toEqual([])
    expect(result.objectChanges).toEqual([])
    expect(result.raw).toEqual({
      effects: {
        status: {
          status: 'success'
        }
      }
    })
  })

  it('executes a swap through Core API when the v2 client is available', async () => {
    const { executeTransaction } = await import('../src/astros-sdk')
    const txb = createTransaction(coins.sui.holder)
    vi.spyOn(txb, 'build').mockResolvedValue(Uint8Array.from([1, 2, 3]))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const signer = {
      signTransaction: vi.fn(async () => ({
        bytes: 'AQID',
        signature: 'signed-signature'
      }))
    }
    const client = {
      core: {
        executeTransaction: vi.fn(async () => ({
          $kind: 'Transaction',
          Transaction: {
            digest: '0xcore',
            effects: {
              status: {
                status: 'success'
              }
            },
            events: [{ type: 'core::event' }],
            balanceChanges: [],
            objectChanges: []
          }
        }))
      },
      executeTransactionBlock: vi.fn()
    }

    const result = await executeTransaction(txb, signer as any, {
      client: client as any
    })

    expect(client.core.executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signed-signature'],
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    expect(client.executeTransactionBlock).not.toHaveBeenCalled()
    expect(result.digest).toBe('0xcore')
    expect(result.events).toEqual([{ type: 'core::event' }])
  })

  it('dry-runs a swap through Core API when the v2 client is available', async () => {
    const { dryRunSwapTransaction } = await import('../src/astros-sdk')
    const txb = createTransaction(coins.sui.holder)
    const buildSpy = vi.spyOn(txb, 'build')
    const client = {
      core: {
        simulateTransaction: vi.fn(async () => ({
          $kind: 'Transaction',
          Transaction: {
            effects: {
              status: {
                status: 'success'
              }
            },
            events: [{ type: 'core::dry-run' }],
            balanceChanges: [],
            objectChanges: []
          }
        }))
      },
      dryRunTransactionBlock: vi.fn()
    }

    const result = await dryRunSwapTransaction(txb, {
      client: client as any
    })

    expect(buildSpy).not.toHaveBeenCalled()
    expect(client.core.simulateTransaction).toHaveBeenCalledWith({
      transaction: txb,
      include: {
        effects: true,
        events: true,
        balanceChanges: true,
        objectTypes: true
      }
    })
    expect(client.dryRunTransactionBlock).not.toHaveBeenCalled()
    expect(result.effects?.status?.status).toBe('success')
    expect(result.events).toEqual([{ type: 'core::dry-run' }])
  })

  // it('should successfully swap SUI through bluefin using single route', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.sui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get SUI coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.sui.holder,
  //     coinType: coins.sui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const amountIn = '1000000000'
  //   const quote = await getQuote(coins.sui.address, coins.vSui.address, amountIn, undefined, {
  //     dexList: [Dex.BLUEFIN],
  //     byAmountIn: true,
  //     depth: 3
  //   })
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.sui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.sui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
  // it('should successfully swap SUI through magma using single route', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.sui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get SUI coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.sui.holder,
  //     coinType: coins.sui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const amountIn = '1000000000'
  //   const quote = await getQuote(coins.sui.address, coins.vSui.address, amountIn, apiKey, {
  //     dexList: [Dex.MAGMA],
  //     byAmountIn: true,
  //     depth: 3
  //   })
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.sui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.sui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
  // it('should successfully swap SUI through turbos using single route', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.sui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get SUI coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.sui.holder,
  //     coinType: coins.sui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const amountIn = '1000000000'
  //   const quote = await getQuote(coins.sui.address, coins.vSui.address, amountIn, apiKey, {
  //     dexList: [Dex.TURBOS],
  //     byAmountIn: true,
  //     depth: 3
  //   })
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.sui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.sui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
  it.skipIf(!runLiveTests)(
    'should successfully swap DEEP through deepbook using single route',
    async () => {
      const testCaseName = expect.getState().currentTestName || 'test_case'
      const txb = createTransaction(coins.deep.holder)
      const suiClient = new SuiJsonRpcClient({
        network: 'mainnet',
        url: getJsonRpcFullnodeUrl('mainnet')
      })
      // Get DEEP coins owned by the holder
      const coinInStruct = await suiClient.getCoins({
        owner: coins.deep.holder,
        coinType: coins.deep.address
      })
      const coinInStructObjectId = coinInStruct.data[0].coinObjectId
      const amountIn = '1000000000'
      const quote = await getQuote(coins.deep.address, coins.sui.address, amountIn, apiKey, {
        dexList: [Dex.DEEPBOOK],
        byAmountIn: true,
        depth: 3
      })
      const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
      const minAmountOut = 0
      const coinOut = await buildSwapPTBFromQuote(
        coins.deep.holder,
        txb,
        minAmountOut,
        coinIn,
        quote,
        0, // referral
        true // ifPrint
      )
      txb.transferObjects([coinOut], coins.deep.holder)
      const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
      expect(tsRes).toEqual('success')
    },
    500000
  )
  // it('should successfully swap SUI through haSui stake using single route', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.sui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get SUI coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.sui.holder,
  //     coinType: coins.sui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const amountIn = '1000000000'
  //   const quote = await getQuote(coins.sui.address, coins.haSui.address, amountIn, apiKey, {
  //     dexList: [Dex.HASUI],
  //     byAmountIn: true,
  //     depth: 3
  //   })
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.sui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.sui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
  // it('should successfully swap haSui through haSui unstake using single route', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.haSui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get haSui coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.haSui.holder,
  //     coinType: coins.haSui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const coinInStructBalance = coinInStruct.data[0].balance
  //   const quote = await getQuote(
  //     coins.haSui.address,
  //     coins.sui.address,
  //     coinInStructBalance,
  //     apiKey,
  //     {
  //       dexList: [Dex.HASUI],
  //       byAmountIn: true,
  //       depth: 3
  //     }
  //   )
  //   // Use actual haSui coin
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [coinInStructBalance])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.haSui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.haSui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
  // it('should successfully swap SUI through vSui stake anyway', async () => {
  //   const testCaseName = expect.getState().currentTestName || 'test_case'
  //   const txb = createTransaction(coins.sui.holder)
  //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })
  //   // Get SUI coins owned by the holder
  //   const coinInStruct = await suiClient.getCoins({
  //     owner: coins.sui.holder,
  //     coinType: coins.sui.address
  //   })
  //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
  //   const amountIn = '1000000000'
  //   const quote = await getQuote(coins.sui.address, coins.vSui.address, amountIn, apiKey, {
  //     dexList: [Dex.VSUI, Dex.CETUS],
  //     byAmountIn: true,
  //     depth: 3
  //   })
  //   expect(quote.routes[0].path[0].provider).toEqual(Dex.VSUI)
  //   // Use SUI coin
  //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
  //   const minAmountOut = 0
  //   const coinOut = await buildSwapPTBFromQuote(
  //     coins.sui.holder,
  //     txb,
  //     minAmountOut,
  //     coinIn,
  //     quote,
  //     0, // referral
  //     true // ifPrint
  //   )
  //   txb.transferObjects([coinOut], coins.sui.holder)
  //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true)
  //   expect(tsRes).toEqual('success')
  // }, 500000)
})

// describe('fee options test', () => {
//   // it('should successfully swap SUI through turbos using single route with fee', async () => {
//   //   const testCaseName = expect.getState().currentTestName || 'test_case'
//   //   const txb = createTransaction(coins.sui.holder)
//   //   const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })

//   //   // Get SUI coins owned by the holder
//   //   const coinInStruct = await suiClient.getCoins({
//   //     owner: coins.sui.holder,
//   //     coinType: coins.sui.address
//   //   })
//   //   const coinInStructObjectId = coinInStruct.data[0].coinObjectId
//   //   const amountIn = '1000000000'

//   //   const quote = await getQuote(coins.sui.address, coins.vSui.address, amountIn, apiKey, {
//   //     dexList: [Dex.TURBOS],
//   //     byAmountIn: true,
//   //     depth: 3
//   //   })

//   //   const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])
//   //   const minAmountOut = 0
//   //   const coinOut = await buildSwapPTBFromQuote(
//   //     coins.sui.holder,
//   //     txb,
//   //     minAmountOut,
//   //     coinIn,
//   //     quote,
//   //     0, // referral
//   //     true, // ifPrint
//   //     undefined,
//   //     {
//   //       serviceFee: {
//   //         fee: 0.5,
//   //         receiverAddress: '0x3be8db6ca4adf33387f16c86c443737e78fd14db85a4e1c68cc8f256ac68549c' // random address
//   //       }
//   //     }
//   //   )

//   //   txb.transferObjects([coinOut], coins.sui.holder)

//   //   const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true, true)
//   //   expect(tsRes).toEqual('success')
//   // }, 500000)

//   it('should successfully swap vSUI through bluefin using single route with fee', async () => {
//     const testCaseName = expect.getState().currentTestName || 'test_case'
//     const txb = createTransaction(coins.vSui.holder)
//     const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })

//     // Get vSUI coins owned by the holder
//     const coinInStruct = await suiClient.getCoins({
//       owner: coins.vSui.holder,
//       coinType: coins.vSui.address
//     })
//     const coinInStructObjectId = coinInStruct.data[0].coinObjectId
//     const coinInStructBalance = coinInStruct.data[0].balance

//     const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [coinInStructBalance])
//     const quote = await getQuote(
//       coins.vSui.address,
//       coins.sui.address,
//       coinInStructBalance,
//       apiKey,
//       {
//         dexList: [Dex.BLUEFIN],
//         byAmountIn: true,
//         depth: 3
//       }
//     )
//     const minAmountOut = 0

//     const coinOut = await buildSwapPTBFromQuote(
//       coins.vSui.holder,
//       txb,
//       minAmountOut,
//       coinIn,
//       quote,
//       0, // referral
//       true, // ifPrint
//       undefined,
//       {
//         serviceFee: {
//           fee: 0.5,
//           receiverAddress: '0x3be8db6ca4adf33387f16c86c443737e78fd14db85a4e1c68cc8f256ac68549c' // random address
//         }
//       }
//     )

//     txb.transferObjects([coinOut], coins.vSui.holder)

//     const tsRes = await handleTransactionResult(txb, suiClient, keypair, testCaseName, true, true)
//     expect(tsRes).toEqual('success')
//   }, 500000)

//   it('should swap PTB with fee options successfully', async () => {
//     const testCaseName = expect.getState().currentTestName || 'test_case'
//     const txb = createTransaction(coins.sui.holder)
//     const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })

//     // Get SUI coins owned by the holder
//     const coinInStruct = await suiClient.getCoins({
//       owner: coins.sui.holder,
//       coinType: coins.sui.address
//     })
//     const coinInStructObjectId = coinInStruct.data[0].coinObjectId
//     const amountIn = '1000000000'

//     // Test sui to vSui swap
//     const fromCoin = coins.sui.address
//     const toCoin = coins.vSui.address
//     const minAmountOut = 0
//     const swapOptions = {
//       dexList: [],
//       byAmountIn: true,
//       depth: 3,
//       feeOption: {
//         fee: 0.5,
//         receiverAddress: '0x3be8db6ca4adf33387f16c86c443737e78fd14db85a4e1c68cc8f256ac68549c'
//       }
//     }

//     const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])

//     // Execute swap
//     const result = await swapPTB(
//       coins.sui.holder,
//       txb,
//       fromCoin,
//       toCoin,
//       coinIn,
//       amountIn,
//       minAmountOut,
//       undefined,
//       swapOptions
//     )

//     // Transfer result back to holder
//     txb.transferObjects([result], coins.sui.holder)

//     // Verify transaction succeeded
//     const txResult = await handleTransactionResult(
//       txb,
//       suiClient,
//       keypair,
//       testCaseName,
//       true,
//       true
//     )
//     expect(txResult).toEqual('success')
//   }, 500000)

//   it('should swap PTB with service fee options successfully', async () => {
//     const testCaseName = expect.getState().currentTestName || 'test_case'
//     const txb = createTransaction(coins.sui.holder)
//     const suiClient = new SuiJsonRpcClient({ network: 'mainnet', url: getJsonRpcFullnodeUrl('mainnet') })

//     // Get SUI coins owned by the holder
//     const coinInStruct = await suiClient.getCoins({
//       owner: coins.sui.holder,
//       coinType: coins.sui.address
//     })
//     const coinInStructObjectId = coinInStruct.data[0].coinObjectId
//     const amountIn = '1000000000'

//     // Test sui to vSui swap
//     const fromCoin = coins.sui.address
//     const toCoin = coins.vSui.address
//     const minAmountOut = 0
//     const swapOptions = {
//       dexList: [],
//       byAmountIn: true,
//       depth: 3,
//       serviceFee: {
//         fee: 0.5,
//         receiverAddress: '0x3be8db6ca4adf33387f16c86c443737e78fd14db85a4e1c68cc8f256ac68549c'
//       }
//     }

//     const coinIn = txb.splitCoins(txb.object(coinInStructObjectId), [1e9])

//     // Execute swap
//     const result = await swapPTB(
//       coins.sui.holder,
//       txb,
//       fromCoin,
//       toCoin,
//       coinIn,
//       amountIn,
//       minAmountOut,
//       undefined,
//       swapOptions
//     )

//     // Transfer result back to holder
//     txb.transferObjects([result], coins.sui.holder)

//     // Verify transaction succeeded
//     const txResult = await handleTransactionResult(
//       txb,
//       suiClient,
//       keypair,
//       testCaseName,
//       true,
//       true
//     )
//     expect(txResult).toEqual('success')
//   }, 500000)
// })
