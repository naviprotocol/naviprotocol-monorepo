import { normalizeSuiAddress } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { getMainnetContext, report, runLiveTests } from './context'

describe.skipIf(!runLiveTests)('getVaults', () => {
  it('loads both vault implementations from the Open API', () => {
    const { vaults } = getMainnetContext()
    expect(vaults.some((vault) => vault.source === 'navi')).toBe(true)
    expect(vaults.some((vault) => vault.source === 'volo')).toBe(true)
    for (const vault of vaults) {
      expect(normalizeSuiAddress(vault.id)).toBe(vault.id)
      expect(vault.assets.baseCoin.decimals).toBeGreaterThanOrEqual(0)
      expect(vault.assets.baseCoin.coinType).toContain('::')
    }
    report.add({
      api: 'getVaults',
      title: 'Load both vault implementations from the Open API',
      status: 'passed',
      purpose: 'Verify that the live API returns usable NAVI and Volo vault definitions.',
      data: { vaultCount: vaults.length, vaults },
      validations: [
        'At least one vault has source=navi.',
        'At least one vault has source=volo.',
        'Every vault ID is already a normalized Sui address.',
        'Every base coin has non-negative decimals and a struct-tag coin type.'
      ]
    })
  })
})
