import { describe, expect, it, vi } from 'vitest'

import {
  devInspectTransaction,
  getSuiObject,
  multiGetSuiObjects,
  parseTxValue,
  withCache
} from '../src/utils'
import type { CacheOption } from '../src/types'

describe('withCache', () => {
  it('returns a Promise on the first call (cache miss)', async () => {
    const fn = vi.fn(async (_options?: Partial<CacheOption>) => 'hello')
    const cached = withCache(fn)

    const result = cached()
    expect(typeof (result as any).then).toBe('function')
    expect(await result).toBe('hello')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns a Promise on subsequent calls (cache hit) — regression for `.then is not a function`', async () => {
    const fn = vi.fn(async (_options?: Partial<CacheOption>) => 'hello')
    const cached = withCache(fn)

    await cached()
    expect(fn).toHaveBeenCalledTimes(1)

    const cachedResult = cached()
    // Critical: cached path must still return a thenable so `.then()` chaining
    // does not throw `TypeError: ... .then is not a function` at call sites.
    expect(typeof (cachedResult as any).then).toBe('function')
    expect(await cachedResult).toBe('hello')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respects disableCache option', async () => {
    const fn = vi.fn(async (_options?: Partial<CacheOption>) => 'hello')
    const cached = withCache(fn)

    await cached()
    await cached({ disableCache: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('respects cacheTime option (cache expired)', async () => {
    const fn = vi.fn(async (_options?: Partial<CacheOption>) => 'hello')
    const cached = withCache(fn)

    await cached()
    // cacheTime smaller than the elapsed time forces a refresh.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await cached({ cacheTime: 1 })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps cache when cacheTime is large enough', async () => {
    const fn = vi.fn(async (_options?: Partial<CacheOption>) => 'hello')
    const cached = withCache(fn)

    await cached({ cacheTime: 60_000 })
    await cached({ cacheTime: 60_000 })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('parseTxValue', () => {
  it('throws a clear error for undefined transaction arguments', () => {
    expect(() => parseTxValue(undefined, vi.fn())).toThrow('Transaction value is required')
  })

  it('throws a clear error for null transaction arguments', () => {
    expect(() => parseTxValue(null, vi.fn())).toThrow('Transaction value is required')
  })
})

describe('Sui Core API adapters', () => {
  it('normalizes core.simulateTransaction command results to devInspect shape', async () => {
    const simulateTransaction = vi.fn(async () => ({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: {
            success: true
          }
        },
        events: []
      },
      commandResults: [
        {
          returnValues: [{ bcs: Uint8Array.from([1, 2, 3]) }],
          mutatedReferences: [{ bcs: Uint8Array.from([4, 5, 6]) }]
        }
      ]
    }))
    const legacyDevInspect = vi.fn()
    const result = await devInspectTransaction(
      {
        core: {
          simulateTransaction
        },
        devInspectTransactionBlock: legacyDevInspect
      },
      {
        transactionBlock: Uint8Array.from([9, 9, 9]),
        sender: `0x${'1'.repeat(64)}`
      }
    )

    expect(simulateTransaction).toHaveBeenCalledWith({
      transaction: Uint8Array.from([9, 9, 9]),
      checksEnabled: false,
      include: {
        effects: true,
        events: true,
        commandResults: true
      }
    })
    expect(legacyDevInspect).not.toHaveBeenCalled()
    expect(result.results?.[0]?.returnValues?.[0]?.[0]).toEqual([1, 2, 3])
    expect(result.results?.[0]?.mutableReferenceOutputs?.[0]?.[1]).toEqual([4, 5, 6])
  })

  it('normalizes core.getObject to JSON-RPC object response shape', async () => {
    const getObject = vi.fn(async () => ({
      object: {
        objectId: '0xobject',
        version: '1',
        digest: 'digest',
        type: '0x2::test::State',
        owner: { AddressOwner: '0xowner' },
        json: {
          borrow_fee_rate: '120'
        }
      }
    }))
    const result = await getSuiObject(
      {
        core: {
          getObject
        }
      },
      {
        id: '0xobject',
        options: { showContent: true, showOwner: true, showType: true }
      }
    )

    expect(getObject).toHaveBeenCalledWith({
      objectId: '0xobject',
      include: {
        json: true,
        display: false,
        previousTransaction: false,
        objectBcs: false
      }
    })
    expect(result.data.content.fields.borrow_fee_rate).toBe('120')
  })

  it('normalizes core.getObjects to JSON-RPC multiGetObjects response shape', async () => {
    const getObjects = vi.fn(async () => ({
      objects: [
        {
          objectId: '0xobject',
          version: '1',
          digest: 'digest',
          type: '0x2::test::State',
          owner: { AddressOwner: '0xowner' },
          json: {
            value: '1'
          }
        }
      ]
    }))
    const result = await multiGetSuiObjects(
      {
        core: {
          getObjects
        }
      },
      {
        ids: ['0xobject'],
        options: { showContent: true }
      }
    )

    expect(getObjects).toHaveBeenCalledWith({
      objectIds: ['0xobject'],
      include: {
        json: true,
        display: false,
        previousTransaction: false,
        objectBcs: false
      }
    })
    expect(result[0].data.content.fields.value).toBe('1')
  })
})
