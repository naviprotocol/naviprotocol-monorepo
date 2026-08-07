import { describe, expect, it } from 'vitest'
import {
  findMarket,
  getDefaultMarket,
  marketDepositHeadroom,
  MarketStatus,
  NaviVaultError,
  resolveDepositMarket,
  resolveMarket,
  ZERO_ADDRESS
} from '../src'
import { market, usdcHighYieldLayout } from './fixtures'

const layout = usdcHighYieldLayout()
const defaultPool = layout.defaultMarket
const otherPool = layout.markets[1]!.poolId

describe('findMarket / getDefaultMarket', () => {
  it('matches regardless of address padding', () => {
    const unpadded = defaultPool.replace(/^0x0+/, '0x')
    expect(findMarket(layout, unpadded)?.poolId).toBe(defaultPool)
  })

  it('treats an unset default market as no market', () => {
    expect(getDefaultMarket({ ...layout, defaultMarket: ZERO_ADDRESS })).toBeUndefined()
  })
})

describe('resolveMarket', () => {
  it('returns the default market when fromDefault is set', () => {
    expect(resolveMarket(layout, { fromDefault: true }).poolId).toBe(defaultPool)
  })

  it('rejects a non-default pool under fromDefault', () => {
    // The contract aborts 10022 here; failing at build time says why.
    expect(() => resolveMarket(layout, { fromDefault: true, poolId: otherPool })).toThrow(
      NaviVaultError
    )
  })

  it('allows any registered market when fromDefault is off', () => {
    expect(resolveMarket(layout, { fromDefault: false, poolId: otherPool }).poolId).toBe(otherPool)
  })

  it('allows withdrawing from a Disabled market', () => {
    // Status is not checked on withdrawal, so a market being wound down stays drainable.
    const winding = {
      ...layout,
      markets: layout.markets.map((entry) =>
        entry.poolId === otherPool ? { ...entry, status: MarketStatus.Disabled } : entry
      )
    }
    expect(resolveMarket(winding, { fromDefault: false, poolId: otherPool }).poolId).toBe(otherPool)
  })

  it('names the registered markets when the pool is unknown', () => {
    try {
      resolveMarket(layout, { fromDefault: false, poolId: `0x${'e'.repeat(64)}` })
      expect.unreachable()
    } catch (error) {
      expect((error as NaviVaultError).message).toContain(defaultPool)
    }
  })
})

describe('resolveDepositMarket', () => {
  it('returns the default market', () => {
    expect(resolveDepositMarket(layout)?.poolId).toBe(defaultPool)
  })

  it('returns undefined when deposits go to idle', () => {
    expect(resolveDepositMarket({ ...layout, defaultMarket: ZERO_ADDRESS })).toBeUndefined()
  })

  it('refuses to deposit into a Disabled default market', () => {
    const disabled = {
      ...layout,
      markets: layout.markets.map((entry) =>
        entry.poolId === defaultPool ? { ...entry, status: MarketStatus.Disabled } : entry
      )
    }
    expect(() => resolveDepositMarket(disabled)).toThrow(NaviVaultError)
  })
})

describe('marketDepositHeadroom', () => {
  it('reports null for an uncapped market', () => {
    expect(marketDepositHeadroom(market({ poolId: '0x1', cap: 0n }))).toBeNull()
  })

  it('reports the remaining room', () => {
    expect(marketDepositHeadroom(market({ poolId: '0x1', cap: 100n, currentBalance: 40n }))).toBe(
      60n
    )
  })

  it('clamps to zero rather than going negative', () => {
    expect(marketDepositHeadroom(market({ poolId: '0x1', cap: 100n, currentBalance: 140n }))).toBe(
      0n
    )
  })
})
