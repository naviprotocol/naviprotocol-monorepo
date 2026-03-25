import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'

import { createAccountCapPTB } from '../src/account-cap'
import {
  createEModeCapPTB,
  emodeIdentityId,
  enterEModePTB,
  exitEModePTB,
  getUserEModeCaps
} from '../src/emode'
import type { EModeIdentity, EnvOption } from '../src/types'
import {
  TEST_ACCOUNT_CAP,
  TEST_ADDRESS,
  TEST_CONFIG,
  devInspectResultFromBytes,
  encodeAddressVector,
  encodeU64Vector
} from './fixtures'

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

const options = {
  env: 'test'
} as EnvOption

const testEmodeId = 1

function getMoveCall(tx: Transaction, index: number) {
  const command = tx.getData().commands[index]
  expect(command?.$kind).toBe('MoveCall')
  return (command as any).MoveCall
}

describe('emodeIdentityId', () => {
  it('should generate emode identity id correctly', () => {
    const emodeIdentity: EModeIdentity = {
      emodeId: 1,
      marketId: 0
    }
    expect(emodeIdentityId(emodeIdentity)).toBe('main-1')
  })

  it('should generate emode identity id for different emodeId', () => {
    const emodeIdentity: EModeIdentity = {
      emodeId: 2,
      marketId: 0
    }
    expect(emodeIdentityId(emodeIdentity)).toBe('main-2')
  })
})

describe('enterEModePTB', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('should create enter emode transaction without accountCap', async () => {
    const tx = new Transaction()
    await enterEModePTB(tx, testEmodeId, options)

    expect(tx.getData().commands).toHaveLength(1)
    expect(getMoveCall(tx, 0).function).toBe('enter_emode')
  })

  it('should create enter emode transaction with accountCap', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, options)

    await enterEModePTB(tx, testEmodeId, {
      ...options,
      accountCap
    })

    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).function).toBe('enter_emode_with_account_cap')
  })

  it('should handle TransactionResult as emodeId', async () => {
    const tx = new Transaction()
    const emodeIdResult = tx.pure.u64(testEmodeId)

    await enterEModePTB(tx, emodeIdResult, options)

    expect(tx.getData().commands).toHaveLength(1)
    expect(getMoveCall(tx, 0).function).toBe('enter_emode')
  })
})

describe('exitEModePTB', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('should create exit emode transaction without accountCap', async () => {
    const tx = new Transaction()
    await exitEModePTB(tx, options)

    expect(tx.getData().commands).toHaveLength(1)
    expect(getMoveCall(tx, 0).function).toBe('exit_emode')
  })

  it('should create exit emode transaction with accountCap', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, options)

    await exitEModePTB(tx, {
      ...options,
      accountCap
    })

    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).function).toBe('exit_emode_with_account_cap')
  })
})

describe('createEModeCapPTB', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('should create emode cap transaction', async () => {
    const tx = new Transaction()
    const accountCap = await createEModeCapPTB(tx, testEmodeId, options)

    expect(accountCap).toBeDefined()
    expect(tx.getData().commands).toHaveLength(4)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).function).toBe('enter_emode_with_account_cap')
    expect(getMoveCall(tx, 2).function).toBe('account_owner')
    expect(getMoveCall(tx, 3).function).toBe('register_emode_for_account_cap')
  })

  it('should create emode cap with custom market', async () => {
    const tx = new Transaction()
    const accountCap = await createEModeCapPTB(tx, testEmodeId, {
      ...options,
      market: 'main'
    })

    expect(accountCap).toBeDefined()
    expect(tx.getData().commands).toHaveLength(4)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).function).toBe('enter_emode_with_account_cap')
    expect(getMoveCall(tx, 2).function).toBe('account_owner')
    expect(getMoveCall(tx, 3).function).toBe('register_emode_for_account_cap')
  })
})

describe('getUserEModeCaps', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('should get user emode caps for a user address', async () => {
    const client = {
      devInspectTransactionBlock: vi
        .fn()
        .mockResolvedValue(
          devInspectResultFromBytes(
            encodeU64Vector([0]),
            encodeU64Vector([testEmodeId]),
            encodeAddressVector([TEST_ACCOUNT_CAP])
          )
        )
    }

    const caps = await getUserEModeCaps(TEST_ADDRESS, {
      ...options,
      client: client as any,
      disableCache: true
    })

    expect(caps).toEqual([
      {
        marketId: 0,
        emodeId: testEmodeId,
        accountCap: TEST_ACCOUNT_CAP
      }
    ])
  })

  it('should handle cache options', async () => {
    const client = {
      devInspectTransactionBlock: vi
        .fn()
        .mockResolvedValue(
          devInspectResultFromBytes(
            encodeU64Vector([0]),
            encodeU64Vector([testEmodeId]),
            encodeAddressVector([TEST_ACCOUNT_CAP])
          )
        )
    }

    const caps = await getUserEModeCaps(TEST_ADDRESS, {
      ...options,
      client: client as any,
      cacheTime: 1000,
      disableCache: true
    })

    expect(Array.isArray(caps)).toBe(true)
    expect(caps[0]?.emodeId).toBe(testEmodeId)
  })

  it('should handle custom client', async () => {
    const client = {
      devInspectTransactionBlock: vi
        .fn()
        .mockResolvedValue(
          devInspectResultFromBytes(
            encodeU64Vector([]),
            encodeU64Vector([]),
            encodeAddressVector([])
          )
        )
    }

    const caps = await getUserEModeCaps(TEST_ADDRESS, {
      ...options,
      client: client as any,
      disableCache: true
    })

    expect(caps).toEqual([])
    expect(client.devInspectTransactionBlock).toHaveBeenCalledTimes(1)
  })
})
