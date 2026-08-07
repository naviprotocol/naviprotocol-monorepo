import { describe, expect, it } from 'vitest'
import {
  configureVaultSdk,
  getVaultConfig,
  isZeroAddress,
  MAINNET_VAULT_CONFIG,
  NaviVaultError,
  resolveVault
} from '../src'

describe('resolveVault', () => {
  it('resolves by config key', () => {
    expect(resolveVault('USDC_PRIME', MAINNET_VAULT_CONFIG).displayName).toBe('USDC Prime')
  })

  it('resolves by object id regardless of padding or case', () => {
    const vault = MAINNET_VAULT_CONFIG.vaults[0]!
    expect(resolveVault(vault.vault, MAINNET_VAULT_CONFIG).key).toBe(vault.key)
    expect(
      resolveVault(vault.vault.toUpperCase().replace('0X', '0x'), MAINNET_VAULT_CONFIG).key
    ).toBe(vault.key)
  })

  it('passes a descriptor straight through', () => {
    const vault = MAINNET_VAULT_CONFIG.vaults[0]!
    expect(resolveVault(vault, MAINNET_VAULT_CONFIG)).toBe(vault)
  })

  it('lists the known keys when nothing matches', () => {
    try {
      resolveVault('NOPE', MAINNET_VAULT_CONFIG)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NaviVaultError)
      expect((error as NaviVaultError).message).toContain('USDC_PRIME')
    }
  })
})

describe('configureVaultSdk', () => {
  it('overrides the bundled snapshot and restores it', async () => {
    const custom = { ...MAINNET_VAULT_CONFIG, vaults: [] }
    configureVaultSdk(custom)
    expect((await getVaultConfig()).vaults).toHaveLength(0)
    configureVaultSdk(undefined)
    expect((await getVaultConfig()).vaults.length).toBeGreaterThan(0)
  })

  it('lets a per-call config win over the global one', async () => {
    const custom = { ...MAINNET_VAULT_CONFIG, vaults: [] }
    expect((await getVaultConfig({ config: custom })).vaults).toHaveLength(0)
  })
})

describe('isZeroAddress', () => {
  it.each([
    ['0x0', true],
    [`0x${'0'.repeat(64)}`, true],
    ['', true],
    ['0x1', false]
  ])('%s -> %s', (value, expected) => {
    expect(isZeroAddress(value)).toBe(expected)
  })
})

describe('bundled snapshot', () => {
  it('keeps the call target and type identity distinct', () => {
    // Interchanging these fails silently in both directions, so the snapshot must never
    // collapse them to one value.
    expect(MAINNET_VAULT_CONFIG.package.packageId).not.toBe(
      MAINNET_VAULT_CONFIG.package.typePackageId
    )
  })

  it('gives every vault exactly one default market', () => {
    for (const vault of MAINNET_VAULT_CONFIG.vaults) {
      expect(vault.markets.filter((market) => market.isDefault)).toHaveLength(1)
    }
  })

  it('does not assume the default market is named main', () => {
    // SUI Prime routes to vsui-sui, USDC Prime to sui-usdc. Hardcoding "main" breaks both.
    const prime = MAINNET_VAULT_CONFIG.vaults.find((vault) => vault.key === 'SUI_PRIME')!
    expect(prime.markets.find((market) => market.isDefault)!.name).not.toBe('main')
  })

  it('gives every harvestable rule a reward fund', () => {
    for (const vault of MAINNET_VAULT_CONFIG.vaults) {
      for (const rule of vault.rewardRules) {
        if (!rule.mustCollectBeforeWithdraw) continue
        expect(rule.rewardFund, `${vault.key} rule ${rule.index}`).toBeTruthy()
        expect(rule.storage, `${vault.key} rule ${rule.index}`).toBeTruthy()
        expect(rule.incentiveV3, `${vault.key} rule ${rule.index}`).toBeTruthy()
      }
    }
  })

  it('allows two vaults to share one coin type', () => {
    // Which is why receipts must be attributed by vault_address, not by type.
    const suiVaults = MAINNET_VAULT_CONFIG.vaults.filter((v) => v.coinType === '0x2::sui::SUI')
    expect(suiVaults.length).toBeGreaterThan(1)
  })
})
