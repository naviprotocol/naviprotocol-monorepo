import { describe, it, expect, beforeAll } from 'vitest'
import {
  enterEModePTB,
  exitEModePTB,
  createEModeCapPTB,
  getUserEModeCaps,
  emodeIdentityId
} from '../src/emode'
import { getLendingPositions } from '../src'
import { depositCoinPTB, getAccountCapOwnerPTB } from '../src'
import { getPools, createAccountCapPTB } from '../src'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../src/utils'
import type { EModeIdentity, EnvOption } from '../src/types'

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

const options = {
  env: 'test'
} as EnvOption

// describe('emodeIdentityId', () => {
//   it('should generate emode identity id correctly', () => {
//     const emodeIdentity: EModeIdentity = {
//       emodeId: 1,
//       marketId: 0
//     }
//     const id = emodeIdentityId(emodeIdentity)
//     expect(id).toBe('main-1')
//   })

//   it('should generate emode identity id for different emodeId', () => {
//     const emodeIdentity: EModeIdentity = {
//       emodeId: 2,
//       marketId: 0
//     }
//     const id = emodeIdentityId(emodeIdentity)
//     expect(id).toBe('main-2')
//   })
// })

// describe('enterEModePTB', () => {
//   let testEmodeId: number

//   beforeAll(async () => {
//     const pools = await getPools(options)
//     const poolWithEmode = pools.find((pool) => pool.emodes && pool.emodes.length > 0)
//     if (poolWithEmode && poolWithEmode.emodes.length > 0) {
//       testEmodeId = poolWithEmode.emodes[0].emodeId
//     } else {
//       testEmodeId = 1 // fallback
//     }
//   })

//   it('should create enter emode transaction without accountCap', async () => {
//     const tx = new Transaction()
//     await enterEModePTB(tx, testEmodeId, options)
//     tx.setSender(testAddress)
//     const dryRunTxBytes: Uint8Array = await tx.build({
//       client: suiClient
//     })
//     const res = await suiClient.dryRunTransactionBlock({
//       transactionBlock: dryRunTxBytes
//     })
//     // Should not have execution error (or have expected error if account doesn't exist)
//     expect(res).toBeDefined()
//   })

//   it('should create enter emode transaction with accountCap', async () => {
//     const tx = new Transaction()
//     const accountCap = await createAccountCapPTB(tx, options)
//     await enterEModePTB(tx, testEmodeId, {
//       ...options,
//       accountCap: accountCap
//     })
//     tx.setSender(testAddress)
//     const dryRunTxBytes: Uint8Array = await tx.build({
//       client: suiClient
//     })
//     const res = await suiClient.dryRunTransactionBlock({
//       transactionBlock: dryRunTxBytes
//     })
//     expect(res).toBeDefined()
//   })

//   it('should handle TransactionResult as emodeId', async () => {
//     const tx = new Transaction()
//     const emodeIdResult = tx.pure.u64(testEmodeId)
//     await enterEModePTB(tx, emodeIdResult, options)
//     tx.setSender(testAddress)
//     const dryRunTxBytes: Uint8Array = await tx.build({
//       client: suiClient
//     })
//     const res = await suiClient.dryRunTransactionBlock({
//       transactionBlock: dryRunTxBytes
//     })
//     expect(res).toBeDefined()
//   })
// })

// describe('exitEModePTB', () => {
//   it('should create exit emode transaction without accountCap', async () => {
//     const tx = new Transaction()
//     await exitEModePTB(tx, options)
//     tx.setSender(testAddress)
//     const dryRunTxBytes: Uint8Array = await tx.build({
//       client: suiClient
//     })
//     const res = await suiClient.dryRunTransactionBlock({
//       transactionBlock: dryRunTxBytes
//     })
//     expect(res).toBeDefined()
//   })

//   it('should create exit emode transaction with accountCap', async () => {
//     const tx = new Transaction()
//     const accountCap = await createAccountCapPTB(tx, options)
//     await exitEModePTB(tx, {
//       ...options,
//       accountCap: accountCap
//     })
//     tx.setSender(testAddress)
//     const dryRunTxBytes: Uint8Array = await tx.build({
//       client: suiClient
//     })
//     const res = await suiClient.dryRunTransactionBlock({
//       transactionBlock: dryRunTxBytes
//     })
//     expect(res).toBeDefined()
//   })
// })

describe('createEModeCapPTB', () => {
  let testEmodeId: number

  beforeAll(async () => {
    const pools = await getPools(options)
    const poolWithEmode = pools.find((pool) => pool.emodes && pool.emodes.length > 0)
    if (poolWithEmode && poolWithEmode.emodes.length > 0) {
      testEmodeId = poolWithEmode.emodes[0].emodeId
    } else {
      testEmodeId = 1 // fallback
    }
  })

  it('should create emode cap transaction', async () => {
    const tx = new Transaction()
    const accountCap = await createEModeCapPTB(tx, testEmodeId, options)

    await depositCoinPTB(
      tx,
      0,
      '0x1acb5117599ba49827c00e5dae88ad92c85d9abd858d7c6ba935660c31fd0218',
      {
        ...options,
        accountCap: accountCap
      }
    )

    tx.transferObjects([accountCap], testAddress)

    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    // Should not have execution error (or have expected error if account doesn't exist)
    expect(res).toBeDefined()
    const object = res.objectChanges?.find((item: any) => {
      return item.objectType?.includes('account::AccountCap')
    })
    expect(object).toBeDefined()
  })

  // it('should create emode cap with custom market', async () => {
  //   const tx = new Transaction()
  //   const accountCap = await createEModeCapPTB(tx, testEmodeId, {
  //     ...options,
  //     market: 'main'
  //   })
  //   tx.transferObjects([accountCap], testAddress)
  //   tx.setSender(testAddress)
  //   const dryRunTxBytes: Uint8Array = await tx.build({
  //     client: suiClient
  //   })
  //   const res = await suiClient.dryRunTransactionBlock({
  //     transactionBlock: dryRunTxBytes
  //   })
  //   expect(res).toBeDefined()
  // })
})

// describe('getUserEModeCaps', () => {
//   it('should get user emode caps for test address', async () => {
//     const caps = await getUserEModeCaps(testAddress, options)
//     expect(Array.isArray(caps)).toBe(true)
//     // The result might be empty if user has no emode caps
//     if (caps.length > 0) {
//       caps.forEach((cap) => {
//         expect(cap).toHaveProperty('marketId')
//         expect(cap).toHaveProperty('emodeId')
//         expect(cap).toHaveProperty('accountCap')
//         expect(typeof cap.marketId).toBe('number')
//         expect(typeof cap.emodeId).toBe('number')
//         expect(typeof cap.accountCap).toBe('string')
//       })
//     }
//   })

//   it('should handle cache options', async () => {
//     const caps = await getUserEModeCaps(testAddress, {
//       ...options,
//       cacheTime: 1000
//     })
//     expect(Array.isArray(caps)).toBe(true)
//   })

//   it('should handle custom client', async () => {
//     const caps = await getUserEModeCaps(testAddress, {
//       ...options,
//       client: suiClient
//     })
//     expect(Array.isArray(caps)).toBe(true)
//   })
// })
