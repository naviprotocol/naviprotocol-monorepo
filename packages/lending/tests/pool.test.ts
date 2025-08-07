import './fetch'
import { describe, it, expect } from 'vitest'
import {
  getPools,
  getStats,
  getFees,
  depositCoinPTB,
  withdrawCoinPTB,
  borrowCoinPTB,
  repayCoinPTB,
  getBorrowFee
} from '../src/pool'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../src/utils'

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

describe('getPools', () => {
  it('prod pools', async () => {
    const pools = await getPools()
    expect(pools).toBeDefined()
    expect(pools.length).toBeGreaterThan(0)
    const naviPool = pools.find(
      (pool) =>
        pool.coinType ===
        'a99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    expect(naviPool).toBeDefined()
    expect(naviPool?.id).toBe(7)
  })
  it('dev pools', async () => {
    const pools = await getPools({ env: 'dev' })
    expect(pools).toBeDefined()
    expect(pools.length).toBeGreaterThan(0)
    const naviPool = pools.find(
      (pool) =>
        pool.coinType ===
        'a99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    expect(naviPool).toBeDefined()
    expect(naviPool?.id).toBe(8)
  })
})

describe('getStats', () => {
  it('check response', async () => {
    const stats = await getStats()
    expect(stats).toBeDefined()
    expect(stats.tvl).toBeGreaterThan(0)
    expect(stats.totalBorrowUsd).toBeGreaterThan(0)
    expect(stats.averageUtilization).toBeGreaterThan(0)
    expect(stats.maxApy).toBeGreaterThan(0)
    expect(stats.userAmount).toBeGreaterThan(0)
    expect(stats.interactionUserAmount).toBeGreaterThan(0)
    expect(stats.borrowFee).toBeGreaterThan(0)
    expect(stats.borrowFeeAddress).toBeDefined()
  })
})

describe('getFees', () => {
  it('check response', async () => {
    const fees = await getFees()
    expect(fees).toBeDefined()
    expect(fees.totalValue).toBeGreaterThan(0)
    expect(fees.v3BorrowFee.totalValue).toBeGreaterThan(0)
    expect(fees.borrowInterestFee.totalValue).toBeGreaterThan(0)
    expect(fees.flashloanAndLiquidationFee.totalValue).toBeGreaterThan(0)
  })
})

describe('depositCoinPTB', () => {
  it('should success deposit 1 Sui', async () => {
    const coinType = '0x2::sui::SUI'
    const tx = new Transaction()
    const [toDeposit] = tx.splitCoins(tx.gas, [1e9 * 0.2])
    await depositCoinPTB(tx, coinType, toDeposit)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res.executionErrorSource).eql(null)
    expect(res.events.length).toBeGreaterThan(0)
  })

  it('should failed insufficient SUI balance for deposit', async () => {
    const coinType = '0x2::sui::SUI'
    const tx = new Transaction()
    const [toDeposit] = tx.splitCoins(tx.gas, [1e9 * 1000])
    await depositCoinPTB(tx, coinType, toDeposit, {
      amount: 1e9 * 1000
    })
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res.executionErrorSource).toBeTypeOf('string')
    expect(res.events.length).eql(0)
  })
})

describe('withdrawCoinPTB', () => {
  it('should success withdraw 0.2 vSUI', async () => {
    const coinType =
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    const tx = new Transaction()
    const withdrawCoins = await withdrawCoinPTB(tx, coinType, 1e9 * 0.2)
    tx.transferObjects([withdrawCoins], testAddress)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    expect(res.executionErrorSource).eql(null)
    expect(res.events.length).toBeGreaterThan(0)
  })
})

describe('borrowCoinPTB', () => {
  it('should success borrow 0.1 vSUI', async () => {
    const testAddress = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
    const coinType =
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    const tx = new Transaction()
    const borrowCoin = await borrowCoinPTB(tx, coinType, 1e9 * 0.1)
    tx.transferObjects([borrowCoin], testAddress)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    expect(res.executionErrorSource).eql(null)
  })
})

describe('repayCoinPTB', () => {
  it('should success repay 0.1 SUI', async () => {
    const coinType = '0x2::sui::SUI'
    const tx = new Transaction()
    await repayCoinPTB(tx, coinType, tx.gas, {
      amount: 1e9 * 0.1
    })
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    expect(res.executionErrorSource).eql(null)
    expect(res.events.length).toBeGreaterThan(0)
  })
})

describe('getBorrowFee', () => {
  it('check response', async () => {
    const fee = await getBorrowFee()
    expect(fee).toBeDefined()
    expect(fee).toBeGreaterThan(0)
  })
})
