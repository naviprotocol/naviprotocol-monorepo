// Read-only, live native/DEX routes; fixed position/market isolates solver performance.
// It never claims synthetic positions are the wallet's holdings. No signing/broadcast.
import { performance } from 'node:perf_hooks'
import { writeFile, mkdir } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { createMultiplyClient, createNaviDataSource, SUI, VSUI, HASUI } from '../dist/index.js'
import { voloConverter, haedalConverter, astrosConverter } from '../dist/converters.js'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  USDSUI = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
const strategies = [
  ['main-vsui-sui', '4', '2', VSUI, SUI, 0],
  ['main-hasui-sui', '5', '1', HASUI, SUI, undefined],
  ['main-usdsui-usdc', '7', '2', USDSUI, USDC, 2]
].map(([id, key, version, c, d, emodeId]) => ({
  id,
  market: 'main',
  registryKey: { strategyNumericId: key, strategyVersion: version },
  ...(emodeId === undefined ? {} : { emodeId }),
  principalCoinType: d,
  collateralCoinType: c,
  debtCoinType: d
}))
const retiredRegistryKeys = ['1', '2', '3', '4', '6', '7'].map((strategyNumericId) => ({
  strategyNumericId,
  strategyVersion: '1'
}))
const owner =
  process.env.MULTIPLY_E2E_ADDRESS ??
  '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: 'https://fullnode.mainnet.sui.io:443'
})
const out = process.env.MULTIPLY_E2E_OUT ?? '/private/tmp/multiply-v3-evidence',
  rounds = Number(process.env.MULTIPLY_BENCH_ROUNDS ?? 10)
await mkdir(out, { recursive: true })
const report = {
  broadcast: false,
  referenceOracleFixture: process.env.MULTIPLY_REFERENCE_ORACLE === 'true',
  timingScope:
    'Planner + real native/DEX calls; fixed protocol market and synthetic 100-token position. Excludes market/discovery/API.',
  samples: [],
  wallet: []
}
const save = () => writeFile(`${out}/exit-benchmark.json`, JSON.stringify(report, null, 2))
for (const s of strategies.filter(
  (s) => !process.env.MULTIPLY_BENCH_STRATEGY || s.id === process.env.MULTIPLY_BENCH_STRATEGY
)) {
  const live = createNaviDataSource({ client, strategies, retiredRegistryKeys })
  const market = await live.readMarket(s)
  const unit = 10n ** BigInt(market.collateral.token.decimals),
    c = BigInt(process.env.MULTIPLY_BENCH_COLLATERAL ?? '100') * unit
  const d = BigInt(
    Math.floor(
      (((Number(c) / Number(unit)) * Number(market.collateralPrice)) / Number(market.debtPrice)) *
        0.5 *
        10 ** market.debt.token.decimals
    )
  )
  const cap = {
    id: '0x' + 'b'.repeat(64),
    accountOwner: '0x' + 'c'.repeat(64),
    strategyId: s.id,
    registryKey: s.registryKey
  }
  const fixed = {
    ...live,
    listAccountCaps: async () => [cap],
    readMarket: async () => ({ ...market }),
    readPosition: async () => ({ collateralAmount: String(c), debtAmount: String(d) })
  }
  for (let round = 0; round < rounds; round++)
    for (const variant of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const row = { strategy: s.id, round, variant, quotes: [], snapshotReads: [] }
      const wrap = (converter) => {
        const q = converter.quote.bind(converter)
        converter.quote = async (req) => {
          const start = performance.now()
          const call = { provider: converter.id, amount: req.amountIn }
          row.quotes.push(call)
          try {
            return await q(req)
          } catch (e) {
            call.error = e.code ?? e.message
            throw e
          } finally {
            call.ms = performance.now() - start
          }
        }
        if (converter.getRedemptionSnapshot) {
          const read = converter.getRedemptionSnapshot.bind(converter)
          converter.getRedemptionSnapshot = async (pair) => {
            const start = performance.now()
            try {
              const result = await read(pair)
              row.snapshot = result
              return result
            } finally {
              row.snapshotReads.push(performance.now() - start)
            }
          }
        }
        return converter
      }
      const engine = createMultiplyClient({
        client,
        dataSource: fixed,
        strategies: [s],
        converters: [wrap(voloConverter({ client })), wrap(haedalConverter({ client }))],
        fallbackConverter: wrap(astrosConverter({ client })),
        disableRedemptionSnapshot: variant === 'before'
      })
      const start = performance.now()
      try {
        const q = await engine.quote(
          owner,
          s,
          { type: 'set_leverage', targetLeverage: '1.5' },
          { minHealthFactor: '1.08', maxSlippageBps: 50 }
        )
        row.result = {
          leverage: q.estimate.leverage,
          hf: q.estimate.healthFactor,
          withdraw: q.execution.withdrawAmount,
          repay: q.execution.flashRepayment,
          conversions: q.execution.conversions.map((c) => ({
            provider: c.converterId,
            input: c.input.amount,
            expected: c.expectedOutput.amount,
            min: c.minOutput.amount
          }))
        }
      } catch (e) {
        row.error = { code: e.code, message: e.message }
      } finally {
        row.ms = performance.now() - start
        report.samples.push(row)
        await save()
        console.log(
          JSON.stringify({
            strategy: s.id,
            round,
            variant,
            ms: Math.round(row.ms),
            quotes: row.quotes.length,
            error: row.error?.code
          })
        )
      }
    }
}
// Real wallet is inspected separately. Every build uses checksEnabled and contains no oracle update.
if (process.env.MULTIPLY_SKIP_WALLET === 'true') process.exit(0)
const live = createNaviDataSource({ client, strategies, retiredRegistryKeys })
const engine = createMultiplyClient({
  client,
  dataSource: live,
  strategies,
  retiredRegistryKeys,
  prepareOracleForSimulation: false
})
const caps = await live.listAccountCaps(owner)
for (const s of strategies) {
  if (!caps.some((c) => c.strategyId === s.id)) {
    report.wallet.push({ strategy: s.id, status: 'no current Cap' })
    continue
  }
  for (const action of [
    { type: 'set_leverage', targetLeverage: s.id === 'main-vsui-sui' ? '6.97' : '1.5' },
    { type: 'set_leverage', targetLeverage: '1' },
    {
      type: 'remove_principal',
      amount: s.debtCoinType === SUI ? '100000000' : '100000',
      targetLeverage: '1.5'
    },
    { type: 'close' }
  ]) {
    const row = { strategy: s.id, action }
    try {
      const q = await engine.quote(owner, s, action, {
        minHealthFactor: '1.08',
        maxSlippageBps: 50
      })
      row.quote = {
        position: q.execution.snapshot,
        withdraw: q.execution.withdrawAmount,
        repay: q.execution.flashRepayment,
        hf: q.estimate.healthFactor
      }
      const tx = new Transaction()
      tx.setSender(owner)
      tx.setGasBudget(50000000)
      // Reference-only fixture: an explicit simulated update establishes valid
      // oracle state without writing chain state. This is NOT the API build path.
      if (process.env.MULTIPLY_REFERENCE_ORACLE === 'true')
        await live.prepareOracle(tx, s, q.execution.market)
      const commandStart = tx.getData().commands.length
      const built = await engine.buildPTBForSimulation(tx, q, [])
      if (built.coins.length)
        tx.transferObjects(
          built.coins.map((c) => c.coin),
          owner
        )
      const calls = tx
        .getData()
        .commands.slice(commandStart)
        .filter((c) => c.MoveCall)
        .map((c) => `${c.MoveCall.module}::${c.MoveCall.function}`)
      if (calls.some((c) => /update_single_price|update_price_feeds|pyth/.test(c)))
        throw new Error('Unexpected oracle update')
      const bytes = await tx.build({ client })
      const r = await client.core.simulateTransaction({
        transaction: bytes,
        checksEnabled: true,
        include: { effects: true, balanceChanges: true, commandResults: true }
      })
      row.status = (r.Transaction ?? r.FailedTransaction).status
      await writeFile(
        `${out}/wallet-${s.id}-${action.type}-${action.targetLeverage ?? 'all'}.json`,
        JSON.stringify(
          { quote: q, transaction: tx.getData(), simulation: r },
          (_, v) => (v instanceof Uint8Array ? [...v] : typeof v === 'bigint' ? String(v) : v),
          2
        )
      )
    } catch (e) {
      row.error = { code: e.code, message: e.message }
    }
    report.wallet.push(row)
    await save()
    console.log(JSON.stringify(row))
  }
}

await save() // Persist missing-Cap outcomes even when no final action ran.
