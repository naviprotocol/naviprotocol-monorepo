import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  enterEModePTB,
  exitEModePTB,
  createEModeCapPTB,
  getUserEModeCaps,
  emodeIdentityId
} from '../src/emode'
import { depositCoinPTB } from '../src'
import { getPools, createAccountCapPTB } from '../src'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../src/utils'
import type { EModeIdentity, EnvOption } from '../src/types'

vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>()
  return {
    ...actual,
    getConfig: vi.fn(async () => ({
      package: '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb',
      storage: '0x0000000000000000000000000000000000000000000000000000000000000006',
      emode: {
        contract: {
          registryPackage: '0xe1537493622defd5770d00de5b7794a03c20e989bc5a2d70b42e72cc9eb6d9bb',
          registryObject: '0x0000000000000000000000000000000000000000000000000000000000000006'
        }
      }
    }))
  }
})

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

const options = {
  env: 'test'
} as EnvOption
const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

describe('emodeIdentityId', () => {
  it('should generate emode identity id correctly', () => {
    const emodeIdentity: EModeIdentity = {
      emodeId: 1,
      marketId: 0
    }
    const id = emodeIdentityId(emodeIdentity)
    expect(id).toBe('main-1')
  })

  it('should generate emode identity id for different emodeId', () => {
    const emodeIdentity: EModeIdentity = {
      emodeId: 2,
      marketId: 0
    }
    const id = emodeIdentityId(emodeIdentity)
    expect(id).toBe('main-2')
  })
})

describe('enterEModePTB', () => {
  let testEmodeId: number

  beforeAll(async () => {
    if (!runLiveTests) {
      testEmodeId = 1
      return
    }
    const pools = await getPools(options)
    const poolWithEmode = pools.find((pool) => pool.emodes && pool.emodes.length > 0)
    if (poolWithEmode && poolWithEmode.emodes.length > 0) {
      testEmodeId = poolWithEmode.emodes[0].emodeId
    } else {
      testEmodeId = 1 // fallback
    }
  })

  it('should append enter emode command without accountCap', async () => {
    const tx = new Transaction()
    await enterEModePTB(tx, testEmodeId, options)
    const data = tx.getData()

    expect(data.commands).toHaveLength(1)
    expect(data.commands[0]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'enter_emode'
      }
    })
  })

  it('should append enter emode command with accountCap', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, options)
    await enterEModePTB(tx, testEmodeId, {
      ...options,
      accountCap: accountCap
    })
    const data = tx.getData()

    expect(data.commands).toHaveLength(2)
    expect(data.commands[1]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'enter_emode_with_account_cap'
      }
    })
  })

  it('should handle TransactionResult as emodeId', async () => {
    const tx = new Transaction()
    const emodeIdResult = tx.pure.u64(testEmodeId)
    await enterEModePTB(tx, emodeIdResult, options)
    const data = tx.getData()

    expect(data.commands).toHaveLength(1)
    expect(data.commands[0]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'enter_emode'
      }
    })
  })
})

describe('exitEModePTB', () => {
  it('should append exit emode command without accountCap', async () => {
    const tx = new Transaction()
    await exitEModePTB(tx, options)
    const data = tx.getData()

    expect(data.commands).toHaveLength(1)
    expect(data.commands[0]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'exit_emode'
      }
    })
  })

  it('should append exit emode command with accountCap', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, options)
    await exitEModePTB(tx, {
      ...options,
      accountCap: accountCap
    })
    const data = tx.getData()

    expect(data.commands).toHaveLength(2)
    expect(data.commands[1]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'exit_emode_with_account_cap'
      }
    })
  })
})

describe('createEModeCapPTB', () => {
  let testEmodeId: number

  beforeAll(async () => {
    if (!runLiveTests) {
      testEmodeId = 1
      return
    }
    const pools = await getPools(options)
    const poolWithEmode = pools.find((pool) => pool.emodes && pool.emodes.length > 0)
    if (poolWithEmode && poolWithEmode.emodes.length > 0) {
      testEmodeId = poolWithEmode.emodes[0].emodeId
    } else {
      testEmodeId = 1 // fallback
    }
  })

  it.skipIf(!runLiveTests)('should create emode cap transaction', async () => {
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

  it.skipIf(!runLiveTests)('should create emode cap with custom market', async () => {
    const tx = new Transaction()
    const accountCap = await createEModeCapPTB(tx, testEmodeId, {
      ...options,
      market: 'main'
    })
    tx.transferObjects([accountCap], testAddress)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res).toBeDefined()
  })
})

describe.skipIf(!runLiveTests)('getUserEModeCaps', () => {
  it('should get user emode caps for test address', async () => {
    const caps = await getUserEModeCaps(testAddress, options)
    expect(Array.isArray(caps)).toBe(true)
    // The result might be empty if user has no emode caps
    if (caps.length > 0) {
      caps.forEach((cap) => {
        expect(cap).toHaveProperty('marketId')
        expect(cap).toHaveProperty('emodeId')
        expect(cap).toHaveProperty('accountCap')
        expect(typeof cap.marketId).toBe('number')
        expect(typeof cap.emodeId).toBe('number')
        expect(typeof cap.accountCap).toBe('string')
      })
    }
  })

  it('should handle cache options', async () => {
    const caps = await getUserEModeCaps(testAddress, {
      ...options,
      cacheTime: 1000
    })
    expect(Array.isArray(caps)).toBe(true)
  })

  it('should handle custom client', async () => {
    const caps = await getUserEModeCaps(testAddress, {
      ...options,
      client: suiClient
    })
    expect(Array.isArray(caps)).toBe(true)
  })
})
