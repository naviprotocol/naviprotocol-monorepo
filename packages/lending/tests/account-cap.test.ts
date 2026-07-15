import { describe, it, expect, vi } from 'vitest'
import { createAccountCapPTB, getAccountCapOwnerPTB } from '../src'
import { Transaction } from '@mysten/sui/transactions'

vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>()
  return {
    ...actual,
    getConfig: vi.fn(async () => ({
      package: '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb'
    }))
  }
})

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

describe('account cap manage', () => {
  it('should append create and transfer commands', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)
    tx.transferObjects([accountCap], testAddress)

    const data = tx.getData()

    expect(data.commands).toHaveLength(2)
    expect(data.commands[0]).toMatchObject({
      MoveCall: {
        module: 'lending',
        function: 'create_account'
      }
    })
    expect(data.commands[1]).toHaveProperty('TransferObjects')
  })
})

describe('getAccountCapOwnerPTB', () => {
  it('should append account cap owner command', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)
    const owner = await getAccountCapOwnerPTB(tx, accountCap)
    const data = tx.getData()

    expect(owner).toBeDefined()
    expect(data.commands).toHaveLength(2)
    expect(data.commands[1]).toMatchObject({
      MoveCall: {
        module: 'account',
        function: 'account_owner'
      }
    })
  })

  it('should append account cap owner command with env option', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, { env: 'test' })
    const owner = await getAccountCapOwnerPTB(tx, accountCap, { env: 'test' })
    const data = tx.getData()

    expect(owner).toBeDefined()
    expect(data.commands).toHaveLength(2)
    expect(data.commands[1]).toMatchObject({
      MoveCall: {
        module: 'account',
        function: 'account_owner'
      }
    })
  })
})
