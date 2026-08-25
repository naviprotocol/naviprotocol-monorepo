import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import {
  canclePendingDepositPTB,
  canclePendingWithdrawPTB,
  getPendingRequests,
  volo
} from '../../src'
import {
  client,
  dryRun,
  dryRunData,
  getMainnetContext,
  report,
  requireBalanceChange,
  runLiveTests,
  SUI
} from './context'

describe.skipIf(!runLiveTests)('cancel pending request PTBs', () => {
  it('dry-runs a cancellable Volo request when one currently exists', async (testContext) => {
    const { voloPosition } = getMainnetContext()
    const requests = await volo.getPendingRequests(voloPosition.vault, voloPosition.owner, {
      client
    })
    const chainRequest = requests.find((candidate) => candidate.cancellableAt <= Date.now())
    if (!chainRequest) {
      report.add({
        api: 'canclePendingDepositPTB / canclePendingWithdrawPTB',
        title: 'Dry-run a cancellable Volo request',
        status: 'skipped',
        purpose:
          'Simulate cancellation only when a real, currently cancellable Volo request exists.',
        data: {
          owner: voloPosition.owner,
          vaultId: voloPosition.vault.id,
          onChainRequests: requests
        },
        reason: 'No on-chain request had reached its cancellableAt time during this run.'
      })
      testContext.skip()
      return
    }

    const apiRequests = await getPendingRequests(chainRequest.owner, {
      vault: chainRequest.vaultId
    })
    const request = apiRequests.find(
      (candidate) =>
        candidate.type === chainRequest.type &&
        candidate.requestId === chainRequest.requestId.toString() &&
        normalizeSuiAddress(candidate.receiptId) === chainRequest.receiptId
    )
    if (!request) {
      report.add({
        api: 'canclePendingDepositPTB / canclePendingWithdrawPTB',
        title: 'Dry-run a cancellable Volo request',
        status: 'skipped',
        purpose:
          'Simulate cancellation only when the same real request is available from both chain state and the Open API.',
        data: { chainRequest, apiRequests },
        reason: 'The cancellable on-chain request had no matching current Open API record.'
      })
      testContext.skip()
      return
    }

    const tx = new Transaction()
    const cancelResult =
      request.type === 'deposit'
        ? await canclePendingDepositPTB(tx, request)
        : await canclePendingWithdrawPTB(tx, request)
    if (cancelResult) tx.transferObjects([cancelResult], chainRequest.owner)
    const result = await dryRun(tx, chainRequest.owner)
    const cancelEvent = result.events?.find(
      (event) =>
        /cancel/i.test(event.eventType) &&
        String(event.json?.request_id) === request.requestId &&
        String(event.json?.vault_id) === request.vaultId
    )
    expect(cancelEvent).toBeDefined()
    expect(BigInt(requireBalanceChange(result, chainRequest.owner, SUI).amount)).not.toBe(0n)
    const output = dryRunData(result)
    report.add({
      api: request.type === 'deposit' ? 'canclePendingDepositPTB' : 'canclePendingWithdrawPTB',
      title: 'Dry-run a cancellable Volo request',
      status: 'passed',
      purpose:
        'Simulate cancellation of a real Volo request and prove execution with the matching cancel event and owner SUI balance change.',
      data: {
        chainRequest,
        openApiRequest: request,
        effectsStatus: output.effectsStatus
      },
      validations: [
        `A cancel event exists with request_id=${request.requestId} and vault_id=${request.vaultId}.`,
        'The owner SUI balance change is non-zero, proving that the cancellation transaction executed in simulation.'
      ],
      events: output.events,
      balanceChanges: output.balanceChanges
    })
  }, 180_000)
})
