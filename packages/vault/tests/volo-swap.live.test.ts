/**
 * Live checks for the Volo non-principal deposit path, gated behind NAVI_LIVE_TESTS=1.
 *
 * The swap leg needs a real aggregator quote, so these cannot run offline. Nothing is
 * signed and nothing is submitted.
 */
import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { createProtocolRegistry } from '../src'
import { OWNER, USDT, clientWithReceipts, voloStable } from './fixtures'
import { buildOrSkip } from './live'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

function registry() {
  return createProtocolRegistry({ client: clientWithReceipts([]), env: 'prod', options: {} })
}

type Command = { $kind: string; MoveCall?: { module: string; function: string } }

function commandNames(tx: Transaction): string[] {
  return (tx.getData().commands as Command[]).map((command) =>
    command.MoveCall ? `${command.MoveCall.module}::${command.MoveCall.function}` : command.$kind
  )
}

function u64Base64(value: bigint): string {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(value)
  return bytes.toString('base64')
}

async function build(vault = voloStable(), amount = '10') {
  return buildOrSkip('volo swap deposit', async () => {
    const tx = new Transaction()
    await registry()['volo-vault'].depositPTB(tx, vault, OWNER, amount, { coinType: USDT })
    return tx
  })
}

describe.skipIf(!runLiveTests)('non-principal deposit', () => {
  it('swaps into the principal, then deposits the swapped amount', async () => {
    const tx = await build()
    if (!tx) return
    const names = commandNames(tx)

    const swap = names.findIndex((name) => name.includes('swap'))
    const slippage = names.findIndex((name) => name.includes('check_slippage'))
    const value = names.lastIndexOf('coin::value')
    const deposit = names.findIndex((name) => name === 'user_entry::deposit')

    // The swap must precede the deposit, the slippage bound must be asserted on chain,
    // and the deposit's amount must come from coin::value — the swap output is not known
    // at build time, so a literal amount would be wrong.
    expect(swap).toBeGreaterThanOrEqual(0)
    expect(slippage).toBeGreaterThan(swap)
    expect(value).toBeGreaterThan(swap)
    expect(deposit).toBeGreaterThan(value)
  }, 240_000)

  it("scales the input by the deposit asset's decimals, not the principal's", async () => {
    // USDT and USDC are both 6 decimals on mainnet, so a vault that declared USDT as 8
    // would expose the bug of reading the principal's decimals instead.
    const vault = voloStable()
    const eightDecimals = {
      ...vault,
      assets: {
        ...vault.assets,
        deposits: [vault.assets.deposits[0]!, { coinType: USDT, decimals: 8 }]
      }
    }

    const tx = await build(eightDecimals, '10')
    if (!tx) return
    const inputs = JSON.stringify(tx.getData().inputs)

    // Pure inputs are BCS, so compare against the encoded little-endian u64 rather than
    // a decimal string.
    expect(inputs).toContain(u64Base64(10n * 10n ** 8n))
    expect(inputs).not.toContain(u64Base64(10n * 10n ** 6n))
  }, 240_000)
})
