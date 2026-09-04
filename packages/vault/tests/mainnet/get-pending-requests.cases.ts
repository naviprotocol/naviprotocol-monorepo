import { describe, expect, it } from 'vitest'
import { volo } from '../../src'
import { client, getMainnetContext, report, runLiveTests } from './context'

describe.skipIf(!runLiveTests)('volo.getPendingRequests', () => {
  it('reads pending requests from on-chain request tables', async () => {
    const { voloPosition } = getMainnetContext()
    const requests = await volo.getPendingRequests(voloPosition.vault, voloPosition.owner, {
      client
    })
    expect(Array.isArray(requests)).toBe(true)
    for (const request of requests) {
      expect(request.owner).toBe(voloPosition.owner)
      expect(request.vaultId).toBe(voloPosition.vault.id)
      expect(request.requestId).toBeTypeOf('bigint')
    }
    report.add({
      api: 'volo.getPendingRequests',
      title: 'Read Volo pending requests from on-chain request tables',
      status: 'passed',
      purpose:
        'Verify Volo request-table parsing with the chain-derived vault holder, including the valid empty-list case.',
      data: {
        owner: voloPosition.owner,
        vaultId: voloPosition.vault.id,
        requests
      },
      validations: [
        'The result is an array.',
        'Every request owner and vault ID matches the query.',
        'Every request ID is parsed as bigint.'
      ]
    })
  })
})
