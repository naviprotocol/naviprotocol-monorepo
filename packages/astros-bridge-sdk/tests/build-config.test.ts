import { describe, expect, it } from 'vitest'

import { bridgeExternal } from '../vite.config.js'

describe('bridge build config', () => {
  it('bundles Mayan while keeping public Sui SDK as a peer external', () => {
    const mayanImporter =
      '/repo/node_modules/.pnpm/@mayanfinance+swap-sdk@15.0.0/node_modules/@mayanfinance/swap-sdk/dist/index.mjs'

    expect(bridgeExternal('@mayanfinance/swap-sdk')).toBe(false)
    expect(bridgeExternal('@mayanfinance/swap-sdk/dist/index.mjs')).toBe(false)
    expect(bridgeExternal('@mysten/sui/transactions', mayanImporter)).toBe(true)
    expect(bridgeExternal('@mysten/sui/transactions')).toBe(true)
    expect(bridgeExternal('@mysten/sui/client')).toBe(true)
  })
})
