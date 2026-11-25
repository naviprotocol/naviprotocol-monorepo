import { describe, expect, it } from 'vitest'
import { marketOraclePrices, oracleDeploymentRevision } from '../src/market-prices'
import type { LendingConfig, MarketSnapshot, Strategy } from '../src/types'
const now = 1800000000000
function fixture() {
  const strategy = {
    market: 'main',
    collateralCoinType: '0x1::a::A',
    debtCoinType: '0x2::b::B'
  } as Strategy
  const config = {
    package: '0x1',
    priceOracle: '0x2',
    oracle: {
      packageId: '0x3',
      feeds: [
        { coinType: strategy.collateralCoinType, oracleId: 1 },
        { coinType: strategy.debtCoinType, oracleId: 2 }
      ]
    }
  } as LendingConfig
  const freshness = {
    version: 1,
    source: 'navi-oracle',
    snapshotId: 'a'.repeat(64),
    observedAtMs: now,
    chainObservedAtMs: now,
    validUntilMs: now + 15000,
    deploymentRevision: oracleDeploymentRevision('prod', 'main', config)
  }
  const pool = (coin: string, id: number, value: string, decimal: number, price: string) =>
    ({
      market: 'main',
      suiCoinType: coin,
      oracleId: id,
      oracle: { valid: true, oracleId: id, value, decimal, price, freshness: { ...freshness } }
    }) as MarketSnapshot['collateral']
  const c = pool(strategy.collateralCoinType, 1, '123456789123456789', 9, '123456789.123456789')
  const d = pool(strategy.debtCoinType, 2, '999999', 6, '0.999999')
  const read = (time = now) => marketOraclePrices(strategy, config, 'prod', c, d, time)
  return { c, d, read, config }
}
describe('market price evidence', () => {
  it('preserves integer precision and the shorter protocol expiry', () => {
    const f = fixture()
    expect(f.read()).toMatchObject({
      collateralPrice: '123456789.123456789',
      debtPrice: '0.999999',
      priceEvidence: { expiresAt: now + 13000 }
    })
    expect(f.read(now + 12999)).toBeDefined()
    expect(f.read(now + 13000)).toBeUndefined()
    expect(f.read(now + 13001)).toBeUndefined()
  })
  it('caps collection age independently of protocol expiry', () => {
    const f = fixture()
    for (const p of [f.c, f.d]) p.oracle.freshness!.validUntilMs = now + 60000
    expect(f.read(now + 27999)).toBeDefined()
    expect(f.read(now + 28000)).toBeUndefined()
  })
  it.each([
    [
      'missing',
      (p: any) => {
        delete p.oracle.freshness
      }
    ],
    [
      'invalid',
      (p: any) => {
        p.oracle.valid = false
      }
    ],
    [
      'zero',
      (p: any) => {
        p.oracle.price = '0'
        p.oracle.value = '0'
      }
    ],
    [
      'mismatched amount',
      (p: any) => {
        p.oracle.price = '1'
      }
    ],
    [
      'numeric value',
      (p: any) => {
        p.oracle.value = 123
      }
    ],
    [
      'NaN',
      (p: any) => {
        p.oracle.price = 'NaN'
      }
    ],
    [
      'market',
      (p: any) => {
        p.market = 'isolated'
      }
    ],
    [
      'coin',
      (p: any) => {
        p.suiCoinType = '0x8::a::A'
      }
    ],
    [
      'oracle id',
      (p: any) => {
        p.oracle.oracleId = 99
      }
    ],
    [
      'future',
      (p: any) => {
        p.oracle.freshness.observedAtMs++
      }
    ],
    [
      'clock skew',
      (p: any) => {
        p.oracle.freshness.chainObservedAtMs += 2001
      }
    ],
    [
      'seconds',
      (p: any) => {
        p.oracle.freshness.observedAtMs /= 1000
      }
    ],
    [
      'expired dependency',
      (p: any) => {
        p.oracle.freshness.validUntilMs = now + 2000
      }
    ],
    [
      'mixed batch',
      (p: any) => {
        p.oracle.freshness.snapshotId = 'b'.repeat(64)
      }
    ],
    [
      'deployment',
      (p: any) => {
        p.oracle.freshness.deploymentRevision += 'old'
      }
    ],
    [
      'unknown version',
      (p: any) => {
        p.oracle.freshness.version = 2
      }
    ]
  ])('rejects both prices when one has %s', (_, mutate) => {
    const f = fixture()
    mutate(f.d)
    expect(f.read()).toBeUndefined()
  })
})

it('rejects an internally consistent pool id that disagrees with deployment feed mapping', () => {
  const f = fixture()
  f.d.oracleId = 99
  f.d.oracle.oracleId = 99
  expect(f.read()).toBeUndefined()
})

it('requires literal boolean validity and a string batch id', () => {
  const f = fixture()
  Object.assign(f.d.oracle, { valid: 'false' })
  expect(f.read()).toBeUndefined()
  Object.assign(f.d.oracle, { valid: true })
  Object.assign(f.d.oracle.freshness!, { snapshotId: ['a'.repeat(64)] })
  expect(f.read()).toBeUndefined()
})
