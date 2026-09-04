import { describe, expect, it } from 'vitest'
import { getPositions } from '../../src'
import { getMainnetContext, report, runLiveTests } from './context'

describe.skipIf(!runLiveTests)('getPositions', () => {
  it.each(['navi', 'volo'] as const)(
    'queries Open API positions for the chain-derived %s wallet',
    async (source) => {
      const context = getMainnetContext()
      const position = source === 'navi' ? context.naviPosition : context.voloPosition
      const positions = await getPositions(position.owner, {
        vaults: [position.vault.id],
        disableCache: true
      })
      expect(positions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            vaultId: position.vault.id,
            address: position.owner,
            source: position.source
          })
        ])
      )
      report.add({
        api: 'getPositions',
        title: `Query Open API positions for the chain-derived ${source} wallet`,
        status: 'passed',
        purpose:
          'Verify that the Open API position agrees with the source, vault, and holder discovered independently from chain data.',
        data: {
          query: { address: position.owner, vaults: [position.vault.id] },
          positions
        },
        validations: [
          `A returned position has vaultId=${position.vault.id}.`,
          `The returned holder address equals ${position.owner}.`,
          `The returned source equals ${position.source}.`
        ]
      })
    }
  )
})
