import { describe, it, expect } from 'vitest'
import { createAccountCapPTB, getAccountCapOwnerPTB } from '../src'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../src/utils'

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

describe('account cap manage', () => {
  it('create and destroy', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)
    tx.transferObjects([accountCap], testAddress)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res.executionErrorSource).eql(null)
    const object = res.objectChanges.find((item: any) => {
      return item.objectType?.includes('account::AccountCap')
    })
    expect(object).toBeDefined()
  })
})

describe('getAccountCapOwnerPTB', () => {
  it('should get account cap owner', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx)
    const owner = await getAccountCapOwnerPTB(tx, accountCap)
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res).toBeDefined()
    expect(owner).toBeDefined()
  })

  it('should get account cap owner with env option', async () => {
    const tx = new Transaction()
    const accountCap = await createAccountCapPTB(tx, { env: 'test' })
    const owner = await getAccountCapOwnerPTB(tx, accountCap, { env: 'test' })
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suiClient
    })
    const res = await suiClient.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res).toBeDefined()
    expect(owner).toBeDefined()
  })
})
