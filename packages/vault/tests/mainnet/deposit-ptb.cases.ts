import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { depositPTB } from '../../src'
import {
  client,
  depositAmountFor,
  discoverDepositor,
  dryRun,
  dryRunData,
  unavoidableAbort,
  report,
  requireBalanceChange,
  rawToHuman,
  requireEvent,
  runLiveTests,
  SUI,
  vaultEventType
} from './context'

describe.skipIf(!runLiveTests)('depositPTB', () => {
  it.for(['navi', 'volo'] as const)(
    'dry-runs a %s deposit',
    async (source, testContext) => {
      const title = `Dry-run a ${source.toUpperCase()} deposit`
      const purpose =
        'Simulate a one-token deposit from a wallet discovered on mainnet and prove the exact deposit through event and balance data.'

      let depositor: Awaited<ReturnType<typeof discoverDepositor>>
      try {
        depositor = await discoverDepositor(source)
      } catch (error) {
        report.add({
          api: 'depositPTB',
          title,
          status: 'skipped',
          purpose,
          reason: `No ${source} vault with status=open had a discoverable, funded depositor (${
            error instanceof Error ? error.message : String(error)
          }).`
        })
        testContext.skip()
        return
      }

      const { owner, vault } = depositor
      const amount = depositAmountFor(vault)
      const tx = new Transaction()
      const result = await depositPTB(
        tx,
        vault,
        owner,
        rawToHuman(amount, vault.assets.baseCoin.decimals),
        {
          client,
          useGasCoin: normalizeStructTag(vault.assets.baseCoin.coinType) === SUI
        }
      )
      // The top-level builder already transfers the receipt (and the Volo change coin) to
      // owner; the caller only gets handles back.
      expect(result.receipt).toBeDefined()
      if (source === 'navi') {
        expect(result.shares).toBeDefined()
        expect(result.requestId).toBeUndefined()
      } else {
        expect(result.requestId).toBeDefined()
        expect(result.shares).toBeUndefined()
      }

      let dryRunResult: Awaited<ReturnType<typeof dryRun>>
      try {
        dryRunResult = await dryRun(tx, owner)
      } catch (error) {
        const abort = unavoidableAbort(error)
        if (abort) {
          report.add({
            api: 'depositPTB',
            title,
            status: 'skipped',
            purpose,
            data: { sender: owner, vault },
            reason: `Vault ${vault.id} rejects deposit requests on chain right now: ${abort.name} (${abort.abortCode}), API status=${vault.status}. ${abort.message}`
          })
          testContext.skip()
          return
        }
        throw error
      }

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
        title,
        status: 'passed',
        purpose,
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
