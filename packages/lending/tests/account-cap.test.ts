import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'

import { createAccountCapPTB, getAccountCapOwnerPTB } from '../src/account-cap'
import { TEST_CONFIG } from './fixtures'

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn()
}))

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 1000 * 60 * 5,
  getConfig: getConfigMock
}))

function getMoveCall(tx: Transaction, index: number) {
  const command = tx.getData().commands[index]
  expect(command?.$kind).toBe('MoveCall')
  return (command as any).MoveCall
}

function expectMoveCall(
  tx: Transaction,
  index: number,
  expected: {
    package?: string
    module?: string
    function?: string
  }
) {
  const moveCall = getMoveCall(tx, index)
  if (expected.package) {
    expect(moveCall.package).toBe(expected.package)
  }
  if (expected.module) {
    expect(moveCall.module).toBe(expected.module)
  }
  if (expected.function) {
    expect(moveCall.function).toBe(expected.function)
  }
  return moveCall
}

describe('account cap manage', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('builds account-cap creation against the configured package', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)

    expect(accountCap).toBeDefined()
    expect(tx.getData().commands).toHaveLength(1)
    expectMoveCall(tx, 0, {
      package: TEST_CONFIG.package,
      module: 'lending',
      function: 'create_account'
    })
  })
})

describe('getAccountCapOwnerPTB', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue(TEST_CONFIG)
  })

  it('should get account cap owner', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)
    const owner = await getAccountCapOwnerPTB(tx, accountCap)

    expect(owner).toBeDefined()
    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).module).toBe('account')
    expect(getMoveCall(tx, 1).function).toBe('account_owner')
  })

  it('should get account cap owner with env option', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, { env: 'test' })
    const owner = await getAccountCapOwnerPTB(tx, accountCap, { env: 'test' })

    expect(owner).toBeDefined()
    expect(tx.getData().commands).toHaveLength(2)
    expect(getMoveCall(tx, 0).function).toBe('create_account')
    expect(getMoveCall(tx, 1).module).toBe('account')
    expect(getMoveCall(tx, 1).function).toBe('account_owner')
  })
})
