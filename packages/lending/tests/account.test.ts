import { describe, it, expect } from 'vitest'
import {
  getUserLendingState,
  getUserHealthFactor,
  getUserDynamicHealthFactorAfterOperator,
  getUserAvailableLendingRewards,
  getUserTotalClaimedReward,
  getUserTransactions,
  getUserClaimedRewardHistory
} from '../src/account'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '../src/types'
import { getPools, PoolOperator } from '../src/pool'

const keypair = Ed25519Keypair.generate()
const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

describe('getUserLendingState', () => {
  it('check no state', async () => {
    const state = await getUserLendingState(keypair.toSuiAddress())
    expect(state).toEqual([])
  })

  it('check with lending state', async () => {
    const state = await getUserLendingState(testAddress)
    expect(state.length).toBeGreaterThan(0)
    const supplyState = state.find((item) => item.supplyBalance !== '0')
    expect(supplyState).toBeDefined()
    const borrowState = state.find((item) => item.borrowBalance !== '0')
    expect(borrowState).toBeDefined()
  })
})

describe('getUserHealthFactor', () => {
  it('check with health factor', async () => {
    const healthFactor = await getUserHealthFactor(testAddress)
    expect(healthFactor).toBeGreaterThan(0)
  })

  it('check Infinity', async () => {
    const healthFactor = await getUserHealthFactor(keypair.toSuiAddress())
    expect(healthFactor).toBe(Infinity)
  })
})

describe('getUserDynamicHealthFactorAfterOperator', () => {
  let lastHf = 0
  it('no operations', async () => {
    const pools = await getPools()
    const pool = pools[10]
    lastHf = await getUserDynamicHealthFactorAfterOperator(testAddress, pool, [])
    expect(lastHf).toBeGreaterThan(0)
  })
  it('supply', async () => {
    const pools = await getPools()
    const pool = pools[10]
    const currentHf = await getUserDynamicHealthFactorAfterOperator(testAddress, pool, [
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
    const currentHf = await getUserDynamicHealthFactorAfterOperator(testAddress, pool!, [
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
    const currentHf = await getUserDynamicHealthFactorAfterOperator(testAddress, pool!, [
      {
        type: PoolOperator.Borrow,
        amount: 3 * Math.pow(10, pool!.token.decimals)
      }
    ])
    expect(currentHf).toBeLessThan(lastHf)
    const diff = Math.abs(currentHf - lastHf)
    expect(diff).toBeGreaterThan(0.03)
  })
  it('repay', async () => {
    const pools = await getPools()
    const pool = pools.find((p) => p.id === 0)
    const currentHf = await getUserDynamicHealthFactorAfterOperator(testAddress, pool!, [
      {
        type: PoolOperator.Repay,
        amount: 30 * Math.pow(10, pool!.token.decimals)
      }
    ])
    expect(currentHf).toBeGreaterThan(lastHf)
    const diff = Math.abs(currentHf - lastHf)
    expect(diff).toBeGreaterThan(1)
  })
})

describe('getUserAvailableLendingRewards', () => {
  it('check with rewards', async () => {
    const rewards = await getUserAvailableLendingRewards(testAddress)
    expect(rewards).toBeDefined()
    expect(rewards.length).toBeGreaterThan(0)
  })
})

describe('getUserTotalClaimedReward', () => {
  it('check with rewards', async () => {
    const rewards = await getUserTotalClaimedReward(testAddress)
    expect(rewards).toBeDefined()
    expect(rewards.USDValue).toBeGreaterThan(0)
  })

  it('check with no rewards', async () => {
    const rewards = await getUserTotalClaimedReward(keypair.toSuiAddress())
    expect(rewards).toBeDefined()
    expect(rewards.USDValue).toBe(0)
  })
})

describe('getUserTransactions', () => {
  let transactions: Transaction[] = []
  let cursor: string | undefined
  const address = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
  it('check with transactions', async () => {
    const res = await getUserTransactions(address)
    transactions = res.data
    cursor = res.cursor
    expect(transactions).toBeDefined()
    expect(transactions.length).toBeGreaterThan(0)
    expect(cursor).toBeDefined()
  })

  it('check with cursor', async () => {
    const res = await getUserTransactions(address, {
      cursor
    })
    expect(res.data.length).toBeGreaterThan(0)
  })

  it('check new wallet', async () => {
    const res = await getUserTransactions(keypair.toSuiAddress())
    expect(res.data.length).toBe(0)
  })
})

describe('getUserClaimedRewardHistory', () => {
  const address = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
  it('check with rewards', async () => {
    const rewards = await getUserClaimedRewardHistory(address)
    expect(rewards).toBeDefined()
    expect(rewards.data.length).toBeGreaterThan(0)
  })
})
