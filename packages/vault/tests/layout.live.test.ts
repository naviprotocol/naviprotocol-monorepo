/**
 * Live mainnet reads. Gated behind NAVI_LIVE_TESTS=1 so CI stays hermetic.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 */
import { createNaviSuiClient } from '@naviprotocol/lending'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  diffLayoutAgainstConfig,
  getVaultLayout,
  getVaultQuote,
  MAINNET_VAULT_CONFIG,
  MarketStatus,
  resolveVault,
  selectHarvestableRules,
  sharePrice,
  findReceipts
} from '../src'
import type { VaultLayout } from '../src'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'
const client = runLiveTests ? createNaviSuiClient() : undefined
const options = () => ({ client: client as never })

const VAULT_KEYS = MAINNET_VAULT_CONFIG.vaults.map((vault) => vault.key)

describe.skipIf(!runLiveTests)('getVaultLayout', () => {
  const layouts = new Map<string, VaultLayout>()

  beforeAll(async () => {
    for (const key of VAULT_KEYS) {
      layouts.set(key, await getVaultLayout(key, options()))
    }
  }, 120_000)

  it.each(VAULT_KEYS)('%s decodes', (key) => {
    const layout = layouts.get(key)!
    expect(layout.markets.length).toBeGreaterThan(0)
    expect(layout.version).toBeGreaterThan(0n)
    for (const market of layout.markets) {
      expect(market.poolId).toMatch(/^0x[0-9a-f]{64}$/)
      expect([MarketStatus.Active, MarketStatus.Disabled]).toContain(market.status)
    }
  })

  it.each(VAULT_KEYS)('%s matches the bundled snapshot', (key) => {
    const descriptor = resolveVault(key, MAINNET_VAULT_CONFIG)
    const issues = diffLayoutAgainstConfig(layouts.get(key)!, descriptor)
    // A failure here means the snapshot has drifted from chain, which is the exact
    // condition that makes transactions abort. It is a signal to re-dump, not a flake.
    expect(issues, issues.join('\n')).toEqual([])
  })

  it.each(VAULT_KEYS)('%s resolves a reward fund for every harvestable rule', (key) => {
    const descriptor = resolveVault(key, MAINNET_VAULT_CONFIG)
    expect(() => selectHarvestableRules(layouts.get(key)!, descriptor)).not.toThrow()
  })

  it('USDC High Yield carries the inactive vault-native rule', () => {
    const layout = layouts.get('USDC')!
    const native = layout.rules.find((rule) => rule.isVaultNative)
    expect(native).toBeDefined()
    // Vault-native rules are exempt from the harvest requirement even when active.
    expect(selectHarvestableRules(layout, resolveVault('USDC', MAINNET_VAULT_CONFIG)).length).toBe(
      layout.rules.filter((rule) => rule.isActive && !rule.isVaultNative).length
    )
  })

  it('the Prime vaults have no reward rules at all', () => {
    expect(layouts.get('SUI_PRIME')!.rules).toEqual([])
    expect(layouts.get('USDC_PRIME')!.rules).toEqual([])
  })

  it('the default market is not always named main', () => {
    const prime = layouts.get('SUI_PRIME')!
    const descriptor = resolveVault('SUI_PRIME', MAINNET_VAULT_CONFIG)
    const main = descriptor.markets.find((market) => market.name === 'main')
    expect(main?.pool).not.toBe(prime.defaultMarket)
  })
})

describe.skipIf(!runLiveTests)('getVaultQuote', () => {
  it.each(VAULT_KEYS)(
    '%s prices against a synchronized snapshot',
    async (key) => {
      const quote = await getVaultQuote(key, options())
      expect(quote.totalAssets).toBeGreaterThan(0n)
      expect(quote.totalShares).toBeGreaterThan(0n)

      // totalAssets is idle + the sum of the market balances, by definition.
      const summed = Object.values(quote.marketBalances).reduce((a, b) => a + b, quote.idleBalance)
      expect(summed).toBe(quote.totalAssets)

      const price = sharePrice(quote)
      expect(price).toBeGreaterThan(0)
      // Share price only grows from 1; a value below it would mean loss beyond yield.
      expect(price).toBeGreaterThanOrEqual(0.9)
    },
    60_000
  )

  it('reports headroom against the vault cap', async () => {
    const quote = await getVaultQuote('USDC', options())
    expect(quote.depositHeadroom).not.toBeNull()
    expect(quote.depositHeadroom!).toBeGreaterThanOrEqual(0n)
  }, 60_000)
})

describe.skipIf(!runLiveTests)('findReceipts', () => {
  it('returns nothing for an address that holds none, without erroring', async () => {
    const receipts = await findReceipts(`0x${'0'.repeat(63)}1`, 'USDC', options())
    expect(receipts).toEqual([])
  }, 60_000)
})
