import { describe, it, expect, vi } from 'vitest'
import {
  getLendingState,
  getHealthFactor,
  getSimulatedHealthFactor,
  getTransactions,
  getCoins,
  mergeCoinsPTB,
  UserPositions
} from '../src/account'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction as NAVITransaction } from '../src/types'
import { getPools, PoolOperator, depositCoinPTB } from '../src/pool'
import { suiClient } from '../src/utils'
import { Transaction } from '@mysten/sui/transactions'
import type { CoinStruct } from '@mysten/sui/jsonRpc'

const keypair = Ed25519Keypair.generate()
const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

describe('getCoins Core API adapter', () => {
  it('uses core.listCoins for coin-type-specific reads', async () => {
    const client = {
      core: {
        listCoins: vi.fn(async () => ({
          objects: [
            {
              objectId: `0x${'1'.repeat(64)}`,
              version: '1',
              digest: 'digest',
              type: '0x2::coin::Coin<0x2::test::COIN>',
              balance: '100'
            }
          ],
          cursor: null,
          hasNextPage: false
        }))
      },
      getCoins: vi.fn(),
      getAllCoins: vi.fn()
    }

    const coins = await getCoins(testAddress, {
      coinType: '0x2::test::COIN',
      client: client as any
    })

    expect(client.core.listCoins).toHaveBeenCalledWith({
      owner: testAddress,
      coinType: '0x2::test::COIN',
      cursor: null,
      limit: 100
    })
    expect(client.getCoins).not.toHaveBeenCalled()
    expect(coins[0]?.coinObjectId).toBe(`0x${'1'.repeat(64)}`)
    expect(coins[0]?.coinType).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000002::test::COIN'
    )
  })

  it('uses core.listBalances and paginated listCoins for all coin reads', async () => {
    const client = {
      core: {
        listBalances: vi
          .fn()
          .mockResolvedValueOnce({
            balances: [{ coinType: '0x2::sui::SUI' }],
            cursor: 'next-balances'
          })
          .mockResolvedValueOnce({
            balances: [{ coinType: '0x2::test::COIN' }],
            cursor: null
          }),
        listCoins: vi
          .fn()
          .mockResolvedValueOnce({
            objects: [
              {
                objectId: `0x${'2'.repeat(64)}`,
                type: '0x2::coin::Coin<0x2::sui::SUI>',
                balance: '1'
              }
            ],
            cursor: null
          })
          .mockResolvedValueOnce({
            objects: [
              {
                objectId: `0x${'3'.repeat(64)}`,
                type: '0x2::coin::Coin<0x2::test::COIN>',
                balance: '2'
              }
            ],
            cursor: 'next-coins'
          })
          .mockResolvedValueOnce({
            objects: [
              {
                objectId: `0x${'4'.repeat(64)}`,
                type: '0x2::coin::Coin<0x2::test::COIN>',
                balance: '3'
              }
            ],
            cursor: null
          })
      },
      getAllCoins: vi.fn()
    }

    const coins = await getCoins(testAddress, {
      client: client as any
    })

    expect(client.core.listBalances).toHaveBeenCalledTimes(2)
    expect(client.core.listCoins).toHaveBeenCalledTimes(3)
    expect(client.getAllCoins).not.toHaveBeenCalled()
    expect(coins.map((coin) => coin.coinObjectId)).toEqual([
      `0x${'2'.repeat(64)}`,
      `0x${'3'.repeat(64)}`,
      `0x${'4'.repeat(64)}`
    ])
    expect(coins.map((coin) => coin.coinType)).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
      '0x0000000000000000000000000000000000000000000000000000000000000002::test::COIN',
      '0x0000000000000000000000000000000000000000000000000000000000000002::test::COIN'
    ])
  })
})

describe.skipIf(!runLiveTests)('getLendingState', () => {
  it('check no state', async () => {
    const state = await getLendingState(keypair.toSuiAddress())
    expect(state).toEqual([])
  })

  it('check with lending state', async () => {
    const state = await getLendingState(testAddress)
    expect(state.length).toBeGreaterThan(0)
    const supplyState = state.find((item) => item.supplyBalance !== '0')
    expect(supplyState).toBeDefined()
    const borrowState = state.find((item) => item.borrowBalance !== '0')
    expect(borrowState).toBeDefined()
  })
})

describe.skipIf(!runLiveTests)('getHealthFactor', () => {
  it('check with health factor', async () => {
    const healthFactor = await getHealthFactor(testAddress)
    expect(healthFactor).toBeGreaterThan(0)
  })

  it('check Infinity', async () => {
    const healthFactor = await getHealthFactor(keypair.toSuiAddress())
    expect(healthFactor).toBe(Infinity)
  })
})

describe.skipIf(!runLiveTests)('getSimulatedHealthFactor', () => {
  let lastHf = 0
  it('no operations', async () => {
    const pools = await getPools()
    const pool = pools[10]
    lastHf = await getSimulatedHealthFactor(testAddress, pool, [])
    expect(lastHf).toBeGreaterThan(0)
  })
  it('supply', async () => {
    const pools = await getPools()
    const pool = pools[10]
    const currentHf = await getSimulatedHealthFactor(testAddress, pool, [
      {
        type: PoolOperator.Supply,
        amount: 1e9
      }
    ])
    expect(currentHf).toBeGreaterThan(lastHf)
  })
  it('withdraw', async () => {
    const pools = await getPools()
    const pool = pools.find((p) => p.id === 5)
    const currentHf = await getSimulatedHealthFactor(testAddress, pool!, [
      {
        type: PoolOperator.Withdraw,
        amount: 3 * Math.pow(10, pool!.token.decimals)
      }
    ])
    expect(currentHf).toBeLessThan(lastHf)
    const diff = Math.abs(currentHf - lastHf)
    expect(diff).toBeGreaterThan(0.03)
  })
  it('borrow', async () => {
    const pools = await getPools()
    const pool = pools.find((p) => p.id === 5)
    const currentHf = await getSimulatedHealthFactor(testAddress, pool!, [
      {
        type: PoolOperator.Borrow,
        amount: 3 * Math.pow(10, pool!.token.decimals)
      }
    ])
    expect(currentHf).toBeLessThan(lastHf)
    const diff = Math.abs(currentHf - lastHf)
    expect(diff).toBeGreaterThan(0.03)
  })
  it.skipIf(!runLiveTests)('repay', async () => {
    const pools = await getPools()
    const pool = pools.find((p) => p.id === 0)
    const currentHf = await getSimulatedHealthFactor(testAddress, pool!, [
      {
        type: PoolOperator.Repay,
        amount: 1 * Math.pow(10, pool!.token.decimals)
      }
    ])
    expect(currentHf).toBeGreaterThan(lastHf)
  })
})

describe.skipIf(!runLiveTests)('getTransactions', () => {
  let transactions: NAVITransaction[] = []
  let cursor: string | undefined
  const address = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
  it('check with transactions', async () => {
    const res = await getTransactions(address)
    transactions = res.data
    cursor = res.cursor
    expect(transactions).toBeDefined()
    expect(transactions.length).toBeGreaterThan(0)
    expect(cursor).toBeDefined()
  })

  it('check with cursor', async () => {
    const res = await getTransactions(address, {
      cursor
    })
    expect(res.data.length).toBeGreaterThan(0)
  })

  it('check new wallet', async () => {
    const res = await getTransactions(keypair.toSuiAddress())
    expect(res.data.length).toBe(0)
  })
})

describe.skipIf(!runLiveTests)('getCoins', () => {
  let allCoins = [] as CoinStruct[]
  it('should return all coins', async () => {
    allCoins = await getCoins(testAddress)
    expect(allCoins).toBeDefined()
    expect(allCoins.length).toBeGreaterThan(0)
  })
  it('filter by coinType', async () => {
    const coinType =
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    const coins = await getCoins(testAddress, {
      coinType
    })
    expect(coins.length).toBeGreaterThan(0)
    expect(coins.length).toBeLessThan(allCoins.length)
    expect(coins[0].coinType).eqls(coinType)
  })
})

describe('mergeCoinsPTB', () => {
  const fakeCoins = [
    {
      coinObjectId: '0x1',
      balance: '10',
      coinType: '0x1',
      digest: '0x1',
      previousTransaction: '0x1',
      version: ''
    },
    {
      coinObjectId: '0x2',
      balance: '20',
      coinType: '0x1',
      digest: '0x2',
      previousTransaction: '0x2',
      version: ''
    }
  ]
  it('no coins to merge', () => {
    const tx = new Transaction()
    // No coins and no split target -> nothing to merge.
    expect(() => mergeCoinsPTB(tx, [])).toThrow('No coins to merge')
    // When a split IS requested, an empty / zero-balance wallet is an
    // insufficiency, not an empty-merge — report the balance shortfall.
    expect(() => mergeCoinsPTB(tx, [], { balance: 100 })).toThrow(
      'Balance is less than the specified balance: 0 < 100'
    )
    expect(() =>
      mergeCoinsPTB(
        tx,
        [
          {
            coinObjectId: '0x2',
            balance: '0',
            coinType: '0x2',
            digest: '0x2',
            previousTransaction: '0x2',
            version: ''
          }
        ],
        { balance: 100 }
      )
    ).toThrow('Balance is less than the specified balance: 0 < 100')
  })

  it('Balance is less than the specified balance', () => {
    const tx = new Transaction()
    expect(() => mergeCoinsPTB(tx, fakeCoins, { balance: 100 })).toThrow(
      'Balance is less than the specified balance: 30 < 100'
    )
  })

  it('withdraws entirely from the address balance when there are no coin objects', () => {
    const tx = new Transaction()
    const result = mergeCoinsPTB(tx, [], {
      balance: 100,
      addressBalance: '100',
      coinType: '0x2::test::COIN'
    })
    const data = JSON.stringify(tx.getData())
    expect(result).toBeDefined()
    // No coin objects at all: the whole amount is redeemed from the address
    // balance, and the redeemed coin (exactly the amount) is returned directly
    // — NOT split — so no zero-balance Coin result is left dangling.
    expect(data).toContain('redeem_funds')
    expect(data).toContain('FundsWithdrawal')
    expect(data).not.toContain('SplitCoins')
  })

  it('withdraws the shortfall from the address balance when coin objects fall short', () => {
    const tx = new Transaction()
    // objects = 30, need = 100 -> redeem 70 from the address balance, then merge + split
    const result = mergeCoinsPTB(tx, fakeCoins, {
      balance: 100,
      addressBalance: '70',
      coinType: '0x1'
    })
    const data = JSON.stringify(tx.getData())
    expect(result).toBeDefined()
    expect(data).toContain('redeem_funds')
    expect(data).toContain('MergeCoins')
    expect(data).toContain('SplitCoins')
  })

  it('does not touch the address balance when coin objects already cover the amount', () => {
    const tx = new Transaction()
    mergeCoinsPTB(tx, fakeCoins, { balance: 20, addressBalance: '1000', coinType: '0x1' })
    const data = JSON.stringify(tx.getData())
    expect(data).not.toContain('redeem_funds')
    expect(data).toContain('SplitCoins')
  })

  it('throws using the combined total when the address balance is also short', () => {
    const tx = new Transaction()
    // objects 30 + addressBalance 20 = 50 < 100
    expect(() =>
      mergeCoinsPTB(tx, fakeCoins, { balance: 100, addressBalance: '20', coinType: '0x1' })
    ).toThrow('Balance is less than the specified balance: 50 < 100')
  })

  it('does not count the address balance on the SUI gas-coin path', () => {
    const tx = new Transaction()
    const suiCoins = [
      {
        coinObjectId: '0x1',
        balance: '10',
        coinType: '0x2::sui::SUI',
        digest: '0x1',
        previousTransaction: '0x1',
        version: ''
      }
    ]
    // SUI + useGasCoin cannot spend address balance, so it must not count toward
    // sufficiency: 10 coin objects < 100 required -> throw (no silent bad tx).
    expect(() =>
      mergeCoinsPTB(tx, suiCoins, {
        balance: 100,
        useGasCoin: true,
        addressBalance: '1000',
        coinType: '0x2::sui::SUI'
      })
    ).toThrow('Balance is less than the specified balance: 10 < 100')
  })

  it('does not count address balance toward sufficiency when coinType is omitted', () => {
    const tx = new Transaction()
    // objects = 30, addressBalance = 1000 but no coinType -> cannot redeem, so
    // address balance must not count: combined = 30 < 100 -> throw (no bad tx).
    expect(() => mergeCoinsPTB(tx, fakeCoins, { balance: 100, addressBalance: '1000' })).toThrow(
      'Balance is less than the specified balance: 30 < 100'
    )
  })

  it('reports insufficiency (not "No coins to merge") for an address-only shortfall', () => {
    const tx = new Transaction()
    // no coin objects, addressBalance 20 < need 100, coinType provided ->
    // combined 20 < 100 -> insufficiency message, not the empty-wallet error.
    expect(() =>
      mergeCoinsPTB(tx, [], { balance: 100, addressBalance: '20', coinType: '0x1' })
    ).toThrow('Balance is less than the specified balance: 20 < 100')
  })

  it.skipIf(!runLiveTests)('merge vsui coins', async () => {
    const coinType =
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    const userCoins = await getCoins(testAddress, {
      coinType
    })
    let tx = new Transaction()
    const result = mergeCoinsPTB(tx, userCoins)
    expect(result).toBeDefined()
    tx = new Transaction()
    const result2 = mergeCoinsPTB(tx, userCoins)
    expect(result2).toBeDefined()
    await depositCoinPTB(tx, coinType, result2 as any, {
      amount: 1e9
    })
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const a = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    const vSuiBalance = a.balanceChanges.find((b) => b.coinType === coinType)
    expect(vSuiBalance).toBeDefined()
    expect(vSuiBalance?.amount).toBe('-1000000000')
  })

  it.skipIf(!runLiveTests)('merge sui coins', async () => {
    const coinType = '0x2::sui::SUI'
    const userCoins = await getCoins(testAddress, {
      coinType
    })
    const tx = new Transaction()
    const result2 = mergeCoinsPTB(tx, userCoins, {
      useGasCoin: true,
      balance: 1e9
    })
    await depositCoinPTB(tx, coinType, result2, {
      amount: 1e9
    })
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const a = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    const suiBalance = a.balanceChanges.find((b) => b.coinType === coinType)
    expect(suiBalance).toBeDefined()
    expect(Math.abs(Number(suiBalance?.amount))).toBeGreaterThan(1000000000)
  })
})

describe('UserPositions.getPositionsOverview', () => {
  it('should avoid NaN when totalSupplyValue is zero', () => {
    const positions = [
      {
        id: 'supply-zero',
        wallet: testAddress,
        protocol: 'navi',
        market: 'main',
        type: 'navi-lending-supply',
        'navi-lending-supply': {
          amount: '100',
          valueUSD: '0',
          token: {
            coinType: '0x2::sui::SUI',
            decimals: 9,
            logoUri: '',
            symbol: 'SUI',
            price: 0
          },
          pool: {
            supplyIncentiveApyInfo: { apy: '12.34' },
            liquidationFactor: { threshold: 0.8 },
            ltvValue: 0.75,
            suiCoinType: '0x2::sui::SUI'
          } as any
        }
      }
    ] as any

    const overview = new UserPositions([]).getPositionsOverview(positions)

    expect(overview.totalSupplyValue).toBe('0')
    expect(overview.totalsupplyApy).toBe('0')
    expect(overview.netWorthApr).toBe('0')
    expect(overview.totalsupplyApy).not.toBe('NaN')
    expect(overview.netWorthApr).not.toBe('NaN')
  })
})
