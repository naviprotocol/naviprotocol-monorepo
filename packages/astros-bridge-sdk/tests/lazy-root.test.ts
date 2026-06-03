import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/providers/mayan', () => {
  throw new Error('mayan provider should stay lazy at root import')
})

describe('bridge root entry', () => {
  it('does not load mayan provider on root import', async () => {
    const bridge = await import('../src')

    expect(bridge.getSupportChains).toBeTypeOf('function')
    expect(bridge.getQuote).toBeTypeOf('function')
    expect(bridge.swap).toBeTypeOf('function')
  })
})
