import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { withdrawPTB } from '../../src'
import {
  client,
  dryRun,
  dryRunData,
  getMainnetContext,
  report,
  requireBalanceChange,
  requireEvent,
  runLiveTests,
  SUI,
  vaultEventType
} from './context'

describe.skipIf(!runLiveTests)('withdrawPTB', () => {
  it.each(['navi', 'volo'] as const)(
    'dry-runs a %s withdrawal',
    async (source) => {
      const context = getMainnetContext()
      const position = source === 'navi' ? context.naviPosition : context.voloPosition
      const unit = 10n ** BigInt(position.vault.assets.baseCoin.decimals)
      const shares = position.shares > unit ? unit : position.shares
      const tx = new Transaction()
      const coin = await withdrawPTB(
        tx,
        position.vault,
        position.owner,
        { kind: 'shares', shares: shares.toString() },
        { client }
      )
      if (coin) tx.transferObjects([coin], position.owner)
      const result = await dryRun(tx, position.owner)

      if (source === 'navi') {
        const event = requireEvent(result, vaultEventType(source, 'WithdrawEvent'), {
          vault: position.vault.id,
          sender: position.owner,
          receipt_id: position.receiptId,
          amount: shares.toString()
        })
        const withdrawn = BigInt(String(event.json?.amount))
        const burnedShares = BigInt(String(event.json?.shares_burned))
        expect(withdrawn).toBe(shares)
        expect(burnedShares).toBeGreaterThan(0n)
        expect(burnedShares).toBeLessThanOrEqual(position.shares)

        const change = requireBalanceChange(
          result,
          position.owner,
          position.vault.assets.baseCoin.coinType
        )
        if (normalizeStructTag(position.vault.assets.baseCoin.coinType) === SUI) {
          expect(BigInt(change.amount)).toBeLessThan(withdrawn)
        } else {
          expect(BigInt(change.amount)).toBe(withdrawn)
        }

        const output = dryRunData(result)
        report.add({
          api: 'withdrawPTB',
          title: 'Dry-run a NAVI withdrawal',
          status: 'passed',
          purpose:
            'Simulate withdrawing shares from a live NAVI receipt and prove execution through the emitted event and owner balance delta.',
          data: {
            sender: position.owner,
            vault: position.vault,
            receiptId: position.receiptId,
            availableShares: position.shares,
            requestedShares: shares,
            effectsStatus: output.effectsStatus
          },
          validations: [
            `A WithdrawEvent exists for vault=${position.vault.id}, sender=${position.owner}, and receipt=${position.receiptId}.`,
            `The event amount exactly equals the requested ${shares.toString()} shares.`,
            'The event burns more than zero shares and no more than the receipt currently owns.',
            normalizeStructTag(position.vault.assets.baseCoin.coinType) === SUI
              ? 'The SUI balance change is below the withdrawn amount because dry-run gas is included.'
              : 'The base-coin balance increase exactly equals the event withdrawal amount.'
          ],
          events: output.events,
          balanceChanges: output.balanceChanges
        })
      } else {
        requireEvent(result, vaultEventType(source, 'WithdrawRequested'), {
          vault_id: position.vault.id,
          recipient: position.owner,
          receipt_id: position.receiptId,
          shares: shares.toString()
        })
        expect(BigInt(requireBalanceChange(result, position.owner, SUI).amount)).toBeLessThan(0n)

        const output = dryRunData(result)
        report.add({
          api: 'withdrawPTB',
          title: 'Dry-run a Volo withdrawal request',
          status: 'passed',
          purpose:
            'Simulate creating a Volo withdrawal request from a live receipt and prove the request was executed by event fields and gas movement.',
          data: {
            sender: position.owner,
            vault: position.vault,
            receiptId: position.receiptId,
            availableShares: position.shares,
            requestedShares: shares,
            effectsStatus: output.effectsStatus
          },
          validations: [
            `A WithdrawRequested event exists for vault=${position.vault.id}, recipient=${position.owner}, and receipt=${position.receiptId}.`,
            `The event shares field exactly equals ${shares.toString()}.`,
            'The owner has a negative SUI balance change, proving that the simulated request consumed gas.'
          ],
          events: output.events,
          balanceChanges: output.balanceChanges
        })
      }
    },
    180_000
  )
})
