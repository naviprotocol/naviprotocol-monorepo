import { describe, it, expect } from 'vitest'
import { getPools, getAllFlashLoanAssets, getFlashLoanAsset, getStats, getFees } from '../src/pool'

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

describe('getAllFlashLoanAssets', () => {
  it('prod', async () => {
    const assets = await getAllFlashLoanAssets()
    expect(assets).toBeDefined()
    expect(assets.length).toBeGreaterThan(0)
    const navx = assets.find(
      (asset) =>
        asset.coinType ===
        '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    expect(navx).toBeDefined()
    expect(navx?.assetId).toBe(7)
  })
  it('dev', async () => {
    const assets = await getAllFlashLoanAssets({ env: 'dev' })
    expect(assets).toBeDefined()
    expect(assets.length).toBeGreaterThan(0)
    const navx = assets.find(
      (asset) =>
        asset.coinType ===
        '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    expect(navx).toBeDefined()
    expect(navx?.assetId).toBe(8)
  })
})

describe('getFlashLoanAsset', () => {
  it('find by coinType', async () => {
    const navx = await getFlashLoanAsset(
      '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    expect(navx).toBeDefined()
    expect(navx?.assetId).toBe(7)
  })
  it('find by assetId', async () => {
    const navx = await getFlashLoanAsset(7)
    expect(navx).toBeDefined()
    expect(navx?.assetId).toBe(7)
  })
  it('find by poolId', async () => {
    const pools = await getPools()
    const navx = pools.find(
      (pool) =>
        pool.coinType ===
        'a99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
    )
    const navxAsset = await getFlashLoanAsset(navx!)
    expect(navxAsset).toBeDefined()
    expect(navxAsset?.assetId).toBe(7)
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
