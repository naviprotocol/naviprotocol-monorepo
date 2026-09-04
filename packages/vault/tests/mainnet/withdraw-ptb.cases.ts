import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { navi, withdrawPTB } from '../../src'
import {
  client,
  dryRun,
  dryRunData,
  getMainnetContext,
  rawToHuman,
  unavoidableAbort,
  report,
  requireBalanceChange,
  requireEvent,
  runLiveTests,
  SUI,
  vaultEventType
} from './context'

describe.skipIf(!runLiveTests)('withdrawPTB', () => {
  it('dry-runs a navi withdrawal by amount', async () => {
    const context = getMainnetContext()
    const position = context.naviPosition
    const decimals = position.vault.assets.baseCoin.decimals
    const unit = 10n ** BigInt(decimals)

    // navi_vault::withdraw takes an ASSET amount; size the request from the
    // position's on-chain value so it stays coverable by the receipt.
    const vaultInfo = await navi.getVaultInfo(position.vault, { client })
    const totalAssets = BigInt(vaultInfo.total_assets)
    const totalShares = BigInt(vaultInfo.total_shares)
    const positionValue = (position.shares * totalAssets) / totalShares
    const amountRaw = positionValue > unit ? unit : positionValue
    const amountHuman = rawToHuman(amountRaw, decimals)

    const tx = new Transaction()
    const coin = (await withdrawPTB(
      tx,
      position.vault,
      position.owner,
      { kind: 'amount', amount: amountHuman },
      { client }
    )) as TransactionResult
    tx.transferObjects([coin], position.owner)
    const result = await dryRun(tx, position.owner)

    const event = requireEvent(result, vaultEventType('navi', 'WithdrawEvent'), {
      vault: position.vault.id,
      sender: position.owner,
      receipt_id: position.receiptId,
      amount: amountRaw.toString()
    })
    const withdrawn = BigInt(String(event.json?.amount))
    const burnedShares = BigInt(String(event.json?.shares_burned))
    const expectedBurned = (amountRaw * totalShares) / totalAssets
    expect(withdrawn).toBe(amountRaw)
    expect(burnedShares).toBeGreaterThan(0n)
    expect(burnedShares).toBeLessThanOrEqual(position.shares)
    // The contract burns amount * total_shares / total_assets; allow rounding drift
    // between our snapshot of the rate and the one the dry-run executes with.
    const drift =
      burnedShares > expectedBurned ? burnedShares - expectedBurned : expectedBurned - burnedShares
    expect(drift * 1000n).toBeLessThanOrEqual(expectedBurned)

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
      title: 'Dry-run a NAVI withdrawal by amount',
      status: 'passed',
      purpose:
        'Simulate withdrawing an exact asset amount from a live NAVI receipt and prove the contract pays that amount while burning the rate-implied shares.',
      data: {
        sender: position.owner,
        vault: position.vault,
        receiptId: position.receiptId,
        availableShares: position.shares,
        requestedHumanAmount: amountHuman,
        requestedRawAmount: amountRaw,
        burnedShares,
        effectsStatus: output.effectsStatus
      },
      validations: [
        `A WithdrawEvent exists for vault=${position.vault.id}, sender=${position.owner}, and receipt=${position.receiptId}.`,
        `The event amount exactly equals the requested ${amountRaw.toString()} base units.`,
        `The burned shares (${burnedShares.toString()}) match amount*total_shares/total_assets within 0.1%, and never exceed the receipt's holdings.`,
        normalizeStructTag(position.vault.assets.baseCoin.coinType) === SUI
          ? 'The SUI balance change is below the withdrawn amount because dry-run gas is included.'
          : 'The base-coin balance increase exactly equals the event withdrawal amount.'
      ],
      events: output.events,
      balanceChanges: output.balanceChanges
    })
  }, 180_000)

  it('dry-runs a volo withdrawal request', async (testContext) => {
    const context = getMainnetContext()
    const position = context.voloPosition
    const unit = 10n ** BigInt(position.vault.assets.baseCoin.decimals)
    const shares = position.shares > unit ? unit : position.shares
    const tx = new Transaction()
    // Volo withdrawals are asynchronous requests; the builder returns the created
    // request ids (droppable u64s), not a coin.
    const requestIds = (await withdrawPTB(
      tx,
      position.vault,
      position.owner,
      { kind: 'shares', shares: shares.toString() },
      { client }
    )) as TransactionResult[]
    expect(requestIds.length).toBeGreaterThan(0)
    let result: Awaited<ReturnType<typeof dryRun>>
    try {
      result = await dryRun(tx, position.owner)
    } catch (error) {
      const abort = unavoidableAbort(error)
      if (abort) {
        report.add({
          api: 'withdrawPTB',
          title: 'Dry-run a Volo withdrawal request',
          status: 'skipped',
          purpose:
            'Simulate creating a Volo withdrawal request from a live receipt and prove the request was executed by event fields and gas movement.',
          data: {
            sender: position.owner,
            vault: position.vault,
            receiptId: position.receiptId,
            requestedShares: shares,
            plannedRequests: requestIds.length
          },
          reason: `Vault ${position.vault.id} rejects withdraw requests on chain right now: ${abort.name} (${abort.abortCode}), API status=${position.vault.status}. ${abort.message} The PTB itself built ${requestIds.length} request(s).`
        })
        testContext.skip()
        return
      }
      throw error
    }

    requireEvent(result, vaultEventType('volo', 'WithdrawRequested'), {
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
        plannedRequests: requestIds.length,
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
  }, 180_000)
})
