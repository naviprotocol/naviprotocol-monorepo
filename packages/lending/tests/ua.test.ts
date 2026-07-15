import { describe, expect, it } from 'vitest'

import { getUserAgent } from '../src/ua'

describe('getUserAgent', () => {
  it('builds a Node user agent without CommonJS require', () => {
    const userAgent = getUserAgent()

    expect(userAgent).toContain('lending/')
    expect(userAgent).toContain('Node.js')
    expect(userAgent).not.toContain('OS/Unknown')
  })
})
