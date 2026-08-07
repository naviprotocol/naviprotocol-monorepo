import { describe, expect, it } from 'vitest'
import { toLendingOptions } from '../src'
import { usdcHighYieldLayout } from './fixtures'

describe('toLendingOptions', () => {
  it('drops vault-only keys before they reach lending', () => {
    // lending derives its cache key with JSON.stringify over the argument list, and
    // JSON.stringify throws on a BigInt. `layout` is full of them, so forwarding a vault
    // options object wholesale fails inside lending, nowhere near the call site.
    const narrowed = toLendingOptions({
      client: 'client' as never,
      env: 'prod',
      layout: usdcHighYieldLayout()
    })

    expect(narrowed).not.toHaveProperty('layout')
    expect(() => JSON.stringify(narrowed)).not.toThrow()
  })

  it('keeps every key lending understands', () => {
    const narrowed = toLendingOptions({
      client: 'client' as never,
      env: 'dev',
      cacheTime: 1000,
      disableCache: true,
      services: { naviOpenApi: { baseUrl: 'https://example.test' } }
    })

    expect(narrowed).toMatchObject({
      client: 'client',
      env: 'dev',
      cacheTime: 1000,
      disableCache: true
    })
    expect(narrowed).toHaveProperty('services')
  })

  it('omits undefined rather than emitting explicit nulls into the cache key', () => {
    expect(Object.keys(toLendingOptions({ env: 'prod' })!)).toEqual(['env'])
  })

  it('passes undefined through', () => {
    expect(toLendingOptions(undefined)).toBeUndefined()
  })

  it('survives a layout carrying BigInt amounts', () => {
    const layout = usdcHighYieldLayout()
    expect(() => JSON.stringify(layout)).toThrow(/BigInt/)
    expect(() => JSON.stringify(toLendingOptions({ layout }))).not.toThrow()
  })
})
