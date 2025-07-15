import './fetch'
import { describe, it, expect } from 'vitest'
import {
  getAllFlashLoanAssets,
  getFlashLoanAsset,
  flashloanPTB,
  repayFlashLoanPTB
} from '../src/flashloan'
import { getPools } from '../src/pool'
import { Transaction } from '@mysten/sui/transactions'
import { parseDevInspectResult, suiClient } from '../src/utils'

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

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

describe('flashloanPTB', () => {
  it('success flow', async () => {
    const coinType = '0x2::sui::SUI'
    const fee = await getFlashLoanAsset(coinType)
    const tx = new Transaction()
    const [toLoanBalance, receipt] = await flashloanPTB(tx, coinType, 1e9 * 1)
    const [toLoan] = tx.moveCall({
      target: '0x2::coin::from_balance',
      arguments: [toLoanBalance],
      typeArguments: [coinType]
    })
    tx.mergeCoins(tx.gas, [toLoan])
    const repayAmount = Math.floor(2e9 + 2e9 * fee!.flashloanFee)
    const [toRepay] = tx.splitCoins(tx.gas, [repayAmount])
    const [toRepayBalance] = tx.moveCall({
      target: '0x2::coin::into_balance',
      arguments: [toRepay],
      typeArguments: [coinType]
    })
    const [remainingBalance] = await repayFlashLoanPTB(tx, coinType, receipt, toRepayBalance)

    const [toReturn] = tx.moveCall({
      target: '0x2::coin::from_balance',
      arguments: [remainingBalance],
      typeArguments: [coinType]
    })

    tx.transferObjects([toReturn], testAddress)
    const result = await suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: testAddress
    })
    expect(result.error).toBeUndefined()
  })
})
