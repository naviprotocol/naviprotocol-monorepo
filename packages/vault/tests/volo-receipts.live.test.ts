/**
 * Live mainnet check for Volo receipt discovery, gated behind NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * The only thing that catches a wrong `ORIGINAL_PACKAGE_ID['volo-vault']`: it builds the
 * owned-object type filter, and a wrong id matches nothing while reporting no error.
 *
 * The holder and receipt below belong to a third party, found by walking the vault's
 * `receipts` Table. If these start failing, re-discover a holder rather than assuming a
 * regression. Nothing is signed and nothing is submitted.
 */
import { createNaviSuiClient } from '@naviprotocol/lending'
import { describe, expect, it } from 'vitest'
import { listReceipts } from '../src/protocols/shared/chain'
import { ORIGINAL_PACKAGE_ID } from '../src/protocols/shared/constants'
import { pickReceiptWithMostShares } from '../src/protocols/volo-vault/receipt-info'
import { voloWbtcMainnet } from './fixtures'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

const HOLDER = '0x11a64eb39883a1675a844ba394b62373906b1fcb741f7bbf5d48c1d9488451e9'
const HOLDER_RECEIPT = '0x37841fde0e14365a0b49dc752005fd40eb789a5b4d0f01d116da83dc7108f5f6'

function client() {
  return createNaviSuiClient() as never
}

describe.skipIf(!runLiveTests)('Volo receipt discovery', () => {
  it('finds a real receipt through the original package id', async () => {
    const vault = voloWbtcMainnet()
    const receipts = await listReceipts(
      client(),
      {
        originalPackageId: ORIGINAL_PACKAGE_ID[vault.protocol],
        module: 'receipt',
        vaultId: vault.id
      },
      HOLDER
    )
    expect(receipts).toContain(HOLDER_RECEIPT)
  }, 120_000)

  it('reads the settled shares out of the vault receipts table', async () => {
    // Covers receiptParentObjectId and the VaultReceiptInfo layout as well: the contract's
    // own getter returns a reference, so a dynamic-field read is the only way in.
    const chosen = await pickReceiptWithMostShares(client(), voloWbtcMainnet(), [
      HOLDER_RECEIPT,
      `0x${'0'.repeat(63)}1`
    ])
    expect(chosen).toBe(HOLDER_RECEIPT)
  }, 120_000)
})
