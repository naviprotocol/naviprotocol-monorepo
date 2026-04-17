import { describe, expect, it, vi } from 'vitest'

import { withCache } from '../src/utils'
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
