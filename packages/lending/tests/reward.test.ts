import { describe, it, expect } from 'vitest'
import {
  getUserAvailableLendingRewards,
  summaryLendingRewards,
  getUserTotalClaimedReward,
  getUserClaimedRewardHistory,
  claimLendingRewardsPTB
} from '../src/reward'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { LendingReward } from '../src/types'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../src/utils'
import './fetch'

const keypair = Ed25519Keypair.generate()
const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

let rewards: LendingReward[] = []

describe('getUserAvailableLendingRewards', () => {
  it('check with rewards', async () => {
    rewards = await getUserAvailableLendingRewards(testAddress)
    expect(rewards).toBeDefined()
    expect(rewards.length).toBeGreaterThan(0)
  })
})

describe('summaryLendingRewards', () => {
  it('check with rewards', async () => {
    const summary = summaryLendingRewards(rewards)
    expect(summary).toBeDefined()
    expect(summary.length).toBeGreaterThan(0)
    expect(Number(summary[0].rewards[0].available)).toBeGreaterThan(0)
  })
})

describe('claimLendingRewardsPTB', () => {
  it('check with rewards', async () => {
    const tx = new Transaction()
    await claimLendingRewardsPTB(tx, rewards)
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

describe('getUserClaimedRewardHistory', () => {
  const address = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
  it('check with rewards', async () => {
    const rewards = await getUserClaimedRewardHistory(address)
    expect(rewards).toBeDefined()
    expect(rewards.data.length).toBeGreaterThan(0)
  })
})
