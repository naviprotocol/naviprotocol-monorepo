/**
 * Live mainnet checks for the withdraw path, gated behind NAVI_LIVE_TESTS=1.
 *
 *   NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/vault test
 *
 * Withdraw is the only builder that reaches the network: it resolves the oracle entrypoint
 * from NAVI's configuration service, and reads each receipt's redeemable balance to plan
 * the allocation. Nothing is signed and nothing is submitted.
 *
 * The holder and receipt below were discovered from `DepositEvent` and belong to a third
 * party. If these start failing with an empty balance, re-discover a funded holder rather
 * than assuming a regression.
 */
import { Transaction } from '@mysten/sui/transactions'
import { createNaviSuiClient, getConfig } from '@naviprotocol/lending'
import { describe, expect, it } from 'vitest'
import { createProtocolRegistry, readReceiptBalances } from '../src'
import { suiHighYield } from './fixtures'
import { buildOrSkip } from './live'

const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'

const HOLDER = '0xb63f43844a683e4be1157fb456c0cc8d38dedeb8b6c54d25d0b57662f144813e'
const HOLDER_RECEIPT = '0x107f1a0c5e11eeaefaed03c15de0659dc1396d043811a24dd93dba193da741f0'

function client() {
  return createNaviSuiClient() as never
}

function registry() {
  return createProtocolRegistry({ client: client(), env: 'prod', options: {} })
}

type MoveCall = { module: string; function: string; arguments: unknown[] }

/** Resolves a command argument back to the object id it was built from. */
function objectIdOf(tx: Transaction, argument: unknown): string | undefined {
  const index = (argument as { Input?: number }).Input
  if (index === undefined) return undefined
  const input = tx.getData().inputs[index] as { UnresolvedObject?: { objectId: string } }
  return input?.UnresolvedObject?.objectId
}

function moveCalls(tx: Transaction): MoveCall[] {
  return (tx.getData().commands as { MoveCall?: MoveCall }[])
    .filter((command) => command.MoveCall)
    .map((command) => command.MoveCall!)
}

describe.skipIf(!runLiveTests)('readReceiptBalances', () => {
  it('reads a real position through get_user_balance', async () => {
    const balances = await readReceiptBalances(client(), suiHighYield(), [HOLDER_RECEIPT], HOLDER)
    expect(balances).toHaveLength(1)
    expect(balances[0]!.balance).toBeGreaterThan(0n)
  }, 120_000)
})

describe.skipIf(!runLiveTests)('withdrawPTB', () => {
  it('opens with the oracle update, before the market syncs', async () => {
    const tx = await buildOrSkip('withdrawPTB', async () => {
      const built = new Transaction()
      built.setSender(HOLDER)
      await registry()['navi-lending'].withdrawPTB(
        built,
        suiHighYield(),
        HOLDER,
        { kind: 'amount', amount: '10000000' },
        { receipt: HOLDER_RECEIPT }
      )
      return built
    })
    if (!tx) return

    const names = moveCalls(tx).map((call) => `${call.module}::${call.function}`)
    const oracle = names.findIndex((name) => name.includes('oracle'))
    const firstSync = names.findIndex((name) => name.endsWith('sync_market_balance'))
    const withdraw = names.findIndex((name) => name.endsWith('::withdraw'))

    // Order is load-bearing: without the price update the call aborts 1502, and the syncs
    // must precede withdraw or it aborts 10006.
    expect(oracle).toBeGreaterThanOrEqual(0)
    expect(oracle).toBeLessThan(firstSync)
    expect(firstSync).toBeLessThan(withdraw)
  }, 120_000)

  it('passes withdraw arguments in the contract order', async () => {
    const tx = await buildOrSkip('withdrawPTB', async () => {
      const built = new Transaction()
      built.setSender(HOLDER)
      await registry()['navi-lending'].withdrawPTB(
        built,
        suiHighYield(),
        HOLDER,
        { kind: 'amount', amount: '10000000' },
        { receipt: HOLDER_RECEIPT }
      )
      return built
    })
    if (!tx) return
    const withdraw = moveCalls(tx).find((call) => call.function === 'withdraw')!
    // (vault, receipt, clock, oracle, storage, pool, amount, max_shares, from_default,
    //  incentive_v2, incentive_v3, system_state)
    expect(withdraw.arguments).toHaveLength(12)
  }, 120_000)

  it("passes lending's own PriceOracle object", async () => {
    // Not configured per vault: it is a lending-wide object taken from the same config
    // service the oracle entrypoint comes from. Nothing else would catch a wrong id — the
    // builders never execute, so a bad object only shows up as an abort on chain.
    const tx = await buildOrSkip('withdrawPTB', async () => {
      const built = new Transaction()
      built.setSender(HOLDER)
      await registry()['navi-lending'].withdrawPTB(
        built,
        suiHighYield(),
        HOLDER,
        { kind: 'amount', amount: '10000000' },
        { receipt: HOLDER_RECEIPT }
      )
      return built
    })
    if (!tx) return

    const withdraw = moveCalls(tx).find((call) => call.function === 'withdraw')!
    // (vault, receipt, clock, oracle, ...)
    const oracle = objectIdOf(tx, withdraw.arguments[3])
    const { priceOracle } = await getConfig()
    expect(oracle).toBe(priceOracle)
  }, 120_000)

  it('plans the allocation from live balances when no receipt is named', async () => {
    const tx = new Transaction()
    tx.setSender(HOLDER)
    await registry()['navi-lending'].withdrawPTB(tx, suiHighYield(), HOLDER, {
      kind: 'amount',
      amount: '10000000'
    })

    // The holder is funded, so one receipt covers this and only one withdraw is emitted.
    const withdraws = moveCalls(tx).filter((call) => call.function === 'withdraw')
    expect(withdraws).toHaveLength(1)
  }, 120_000)

  it('reports an unfunded holder rather than building an empty block', async () => {
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'].withdrawPTB(tx, suiHighYield(), `0x${'1'.repeat(64)}`, {
        kind: 'all'
      })
    ).rejects.toThrow(/hold|balance/i)
  }, 120_000)
})
