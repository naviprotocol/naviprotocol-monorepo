import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { depositPTB } from '../../src'
import {
  client,
  discoverDepositor,
  dryRun,
  dryRunData,
  report,
  requireBalanceChange,
  requireEvent,
  runLiveTests,
  SUI,
  vaultEventType
} from './context'

describe.skipIf(!runLiveTests)('depositPTB', () => {
  it.each(['navi', 'volo'] as const)(
    'dry-runs a %s deposit',
    async (source) => {
      const { owner, vault } = await discoverDepositor(source)
      const tx = new Transaction()
      const result = await depositPTB(tx, vault, owner, 1n, {
        client,
        useGasCoin: normalizeStructTag(vault.assets.baseCoin.coinType) === SUI
      })
      // NAVI returns (Receipt, shares); Volo returns (request_id, Receipt, change).
      const receipt = source === 'navi' ? result[0] : result[1]
      const change = source === 'volo' ? result[2] : undefined
      if (receipt) tx.transferObjects([receipt], owner)
      if (change) tx.transferObjects([change], owner)
      const dryRunResult = await dryRun(tx, owner)
      const amount = 10n ** BigInt(vault.assets.baseCoin.decimals)
      const event = requireEvent(
        dryRunResult,
        vaultEventType(source, source === 'navi' ? 'DepositEvent' : 'DepositRequested'),
        source === 'navi'
          ? { vault: vault.id, sender: owner, amount: amount.toString() }
          : { vault_id: vault.id, recipient: owner, amount: amount.toString() }
      )
      expect(BigInt(String(event.json?.amount))).toBe(amount)

      const balanceChange = requireBalanceChange(
        dryRunResult,
        owner,
        vault.assets.baseCoin.coinType
      )
      if (normalizeStructTag(vault.assets.baseCoin.coinType) === SUI) {
        expect(BigInt(balanceChange.amount)).toBeLessThan(-amount)
      } else {
        expect(BigInt(balanceChange.amount)).toBe(-amount)
      }

      const output = dryRunData(dryRunResult)
      report.add({
        api: 'depositPTB',
        title: `Dry-run a ${source.toUpperCase()} deposit`,
        status: 'passed',
        purpose:
          'Simulate a one-token deposit from a wallet discovered on mainnet and prove the exact deposit through event and balance data.',
        data: {
          sender: owner,
          vault,
          requestedHumanAmount: '1',
          requestedRawAmount: amount,
          eventType: event.eventType,
          effectsStatus: output.effectsStatus
        },
        validations: [
          `The protocol deposit event exists for vault=${vault.id} and sender/recipient=${owner}.`,
          `The event amount exactly equals 10^${vault.assets.baseCoin.decimals}=${amount.toString()} raw units.`,
          normalizeStructTag(vault.assets.baseCoin.coinType) === SUI
            ? 'The SUI balance decrease is greater than the deposit amount because dry-run gas is included.'
            : 'The base-coin balance decrease exactly equals the deposit amount.'
        ],
        events: output.events,
        balanceChanges: output.balanceChanges
      })
    },
    180_000
  )
})
