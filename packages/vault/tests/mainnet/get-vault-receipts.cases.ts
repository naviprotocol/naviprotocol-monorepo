import { describe, expect, it } from 'vitest'
import {
  getMainnetContext,
  MIN_GAS_BALANCE,
  positionData,
  receiptsFor,
  report,
  runLiveTests
} from './context'

describe.skipIf(!runLiveTests)('getVaultReceipts', () => {
  it.each(['navi', 'volo'] as const)(
    'discovers a funded %s wallet from chain data',
    async (source) => {
      const context = getMainnetContext()
      const position = source === 'navi' ? context.naviPosition : context.voloPosition
      const receipts = await receiptsFor(position.source, position.vault, position.owner)
      expect(receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: position.receiptId, shares: position.shares })
        ])
      )
      report.add({
        api: `${source}.getVaultReceipts`,
        title: `Discover a funded ${source} wallet from chain data`,
        status: 'passed',
        purpose:
          'Prove that the test wallet is discovered from indexed mainnet deposit events and still owns a live receipt.',
        data: { position: positionData(position), currentReceipts: receipts },
        validations: [
          `The current receipt list contains receipt ${position.receiptId}.`,
          `The receipt still has exactly ${position.shares.toString()} shares.`,
          `The wallet has at least ${MIN_GAS_BALANCE.toString()} MIST available for dry-run gas.`
        ]
      })
    }
  )
})
