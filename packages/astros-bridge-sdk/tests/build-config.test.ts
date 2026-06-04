import { describe, expect, it } from 'vitest'

import { bridgeExternal } from '../vite.config.js'

describe('bridge build config', () => {
  it('bundles Mayan while keeping Sui SDK as a peer external', () => {
    expect(bridgeExternal('@mayanfinance/swap-sdk')).toBe(false)
    expect(bridgeExternal('@mayanfinance/swap-sdk/dist/index.mjs')).toBe(false)
    expect(bridgeExternal('@mysten/sui/transactions')).toBe(true)
    expect(bridgeExternal('@mysten/sui/client')).toBe(true)
  })
})
