import { describe, expect, it } from 'vitest'

import { bridgeExternal, resolveMayanLegacySuiImport } from '../vite.config.js'

describe('bridge build config', () => {
  it('bundles Mayan and its legacy Sui SDK while keeping public Sui SDK as a peer external', () => {
    const mayanImporter =
      '/repo/node_modules/.pnpm/@mayanfinance+swap-sdk@13.3.0/node_modules/@mayanfinance/swap-sdk/dist/index.mjs'

    expect(bridgeExternal('@mayanfinance/swap-sdk')).toBe(false)
    expect(bridgeExternal('@mayanfinance/swap-sdk/dist/index.mjs')).toBe(false)
    expect(bridgeExternal('@mysten/sui-v1/client')).toBe(false)
    expect(bridgeExternal('@mysten/sui/transactions', mayanImporter)).toBe(false)
    expect(bridgeExternal('@mysten/sui/transactions')).toBe(true)
    expect(bridgeExternal('@mysten/sui/client')).toBe(true)
    expect(resolveMayanLegacySuiImport('@mysten/sui/transactions', mayanImporter)).toBe(
      '@mysten/sui-v1/transactions'
    )
    expect(resolveMayanLegacySuiImport('@mysten/sui/transactions', '/repo/src/index.ts')).toBe(null)
  })
})
