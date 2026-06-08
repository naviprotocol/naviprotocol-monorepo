import { Transaction as LegacyTransaction } from '@mysten/sui-v1/transactions'
import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'

describe('legacy Sui v1 transaction bytes', () => {
  it('can be parsed by the public Sui v2 Transaction class', async () => {
    const legacyTx = new LegacyTransaction()
    legacyTx.setSender(`0x${'1'.repeat(64)}`)
    legacyTx.setGasBudget(1_000_000)
    legacyTx.setGasPrice(1_000)
    legacyTx.setGasPayment([
      {
        objectId: `0x${'2'.repeat(64)}`,
        version: '1',
        digest: '11111111111111111111111111111111'
      }
    ])

    const legacyBytes = await legacyTx.build()
    const parsed = Transaction.from(legacyBytes)

    expect(parsed).toBeInstanceOf(Transaction)
    expect(parsed.getData().sender).toBe(`0x${'1'.repeat(64)}`)
  })
})
