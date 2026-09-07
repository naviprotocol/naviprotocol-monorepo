import { describe, expect, it } from 'vitest'
import { isVaultSdkError, navi, volo } from '../../src'
import { client, getMainnetContext, report, runLiveTests } from './context'

describe.skipIf(!runLiveTests)('VaultSdkError', () => {
  it.each([
    [
      'navi.getVaultInfo',
      () => getMainnetContext().voloPosition,
      async () => await navi.getVaultInfo(getMainnetContext().voloPosition.vault, { client })
    ],
    [
      'volo.getVaultReceipts',
      () => getMainnetContext().naviPosition,
      async () =>
        await volo.getVaultReceipts(
          getMainnetContext().naviPosition.vault,
          getMainnetContext().naviPosition.owner,
          { client }
        )
    ]
  ] as const)(
    'returns a typed error for a protocol mismatch in %s',
    async (api, getPosition, call) => {
      const position = getPosition()
      let caught: unknown
      try {
        await call()
      } catch (error) {
        caught = error
      }

      expect(isVaultSdkError(caught)).toBe(true)
      if (!isVaultSdkError(caught)) return
      expect(caught.code).toBe('VAULT_UNSUPPORTED')
      expect(caught.details).toMatchObject({ vaultId: position.vault.id })

      report.add({
        api: 'VaultSdkError',
        title: `Return a typed protocol-mismatch error from ${api}`,
        status: 'passed',
        purpose:
          'Verify that invalid cross-protocol calls fail with a stable error code and real vault context.',
        data: {
          calledApi: api,
          chainDerivedVault: position.vault,
          error: caught.toJSON()
        },
        validations: [
          'The thrown value is recognized by isVaultSdkError.',
          'The error code is exactly VAULT_UNSUPPORTED.',
          `The error details identify the real chain-derived vault ${position.vault.id}.`
        ]
      })
    }
  )
})
