import { describe, expect, it } from 'vitest'

import { normalizeTransactionResult } from '../src/transaction-result'

describe('normalizeTransactionResult', () => {
  it('preserves legacy JSON-RPC transaction responses', () => {
    const result = normalizeTransactionResult('execute', {
      digest: '0xlegacy',
      effects: {
        status: {
          status: 'success'
        }
      },
      events: [{ type: '0x2::event::Legacy', parsedJson: { amount: '1' } }],
      balanceChanges: [{ amount: '1' }],
      objectChanges: [{ type: 'mutated', objectId: '0x1' }]
    })

    expect(result).toMatchObject({
      kind: 'execute',
      digest: '0xlegacy',
      effects: {
        status: {
          status: 'success'
        }
      },
      events: [{ type: '0x2::event::Legacy', parsedJson: { amount: '1' } }],
      balanceChanges: [{ amount: '1' }],
      objectChanges: [{ type: 'mutated', objectId: '0x1' }]
    })
  })

  it('unwraps Sui core successful transaction responses as a compatible DTO', () => {
    const result = normalizeTransactionResult('execute', {
      $kind: 'Transaction',
      Transaction: {
        digest: '0xcore',
        status: {
          status: 'success'
        },
        events: [{ type: '0x2::event::Core', json: { amount: '2' } }],
        balanceChanges: [{ amount: '2' }]
      }
    })

    expect(result).toMatchObject({
      kind: 'execute',
      digest: '0xcore',
      effects: {
        status: {
          status: 'success'
        }
      },
      events: [{ type: '0x2::event::Core', parsedJson: { amount: '2' } }],
      balanceChanges: [{ amount: '2' }],
      objectChanges: []
    })
  })

  it('unwraps Sui core failed transaction responses without converting them to success', () => {
    const result = normalizeTransactionResult('execute', {
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: '0xfailed',
        status: {
          status: 'failure',
          error: 'MoveAbort'
        }
      }
    })

    expect(result).toMatchObject({
      kind: 'execute',
      digest: '0xfailed',
      effects: {
        status: {
          status: 'failure',
          error: 'MoveAbort'
        }
      },
      events: [],
      balanceChanges: [],
      objectChanges: []
    })
  })
})
