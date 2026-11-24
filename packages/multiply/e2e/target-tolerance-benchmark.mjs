// Read-only real Astros quotes; synthetic positions, never signs or broadcasts.
// Optional BASELINE_MODULE points to an already built pre-change dist/index.js.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import * as current from '../dist/index.js'
import { BN } from '../dist/utils.js'
import { validateFunding } from '../dist/funding.js'
import {
  withinLtv,
  withinSameReserveCapacity,
  borrowCapacity,
  supplyCapacity
} from '../dist/amounts.js'

const baseline = process.env.BASELINE_MODULE
  ? await import(pathToFileURL(process.env.BASELINE_MODULE).href)
  : undefined
const out = process.env.MULTIPLY_TOLERANCE_OUT ?? '/private/tmp/multiply-tolerance-01/live'
await mkdir(out, { recursive: true })
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: 'https://fullnode.mainnet.sui.io:443'
})
const owner = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const strategy = {
  id: 'usdsui-tolerance-test',
  market: 'main',
  emodeId: 2,
  registryKey: { strategyNumericId: '102', strategyVersion: '1' },
  principalCoinType:
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  collateralCoinType:
    '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
}
const live = current.createNaviDataSource({ client, strategies: [strategy] })
const market = await live.readMarket(strategy)
const fee = await live.readBorrowFeeBps(market)
const pc = new BN(market.collateralPrice).shiftedBy(-market.collateral.token.decimals)
const pd = new BN(market.debtPrice).shiftedBy(-market.debt.token.decimals)
const report = {
  broadcast: false,
  startedAt: new Date().toISOString(),
  market,
  fee,
  scope:
    'Same captured market and fees; live sequential swap quotes; synthetic 100/100000 USDC principal and 2x positions. Not funded transactions.',
  rows: []
}
const save = () => writeFile(`${out}/results.json`, JSON.stringify(report, null, 2))
let caseIndex = 0
for (const minHF of ['1.05', '1.08']) {
  const ratio = BN.minimum(
    new BN(market.ltv).div(market.borrowWeight),
    new BN(market.liquidationThreshold).div(new BN(market.borrowWeight).times(minHF))
  )
  const safe = new BN(1).div(new BN(1).minus(ratio.times('.995'))).decimalPlaces(2, BN.ROUND_FLOOR)
  for (const principal of ['100', '100000'])
    for (const action of ['open', 'increase', 'boundary-open', 'unsafe-open']) {
      const target = safe
        .plus(action === 'unsafe-open' ? '.02' : action === 'boundary-open' ? '.01' : 0)
        .toFixed(2)
      const opening = action !== 'increase'
      const P = new BN(principal).shiftedBy(market.debt.token.decimals)
      const position = {
        collateralAmount: opening
          ? '0'
          : P.times(pd).times(2).div(pc).integerValue(BN.ROUND_FLOOR).toFixed(0),
        debtAmount: opening ? '0' : P.toFixed(0)
      }
      const variants = baseline
        ? [
            ['before', baseline],
            ['after', current]
          ]
        : [['after', current]]
      // Alternate order to avoid attributing a warm connection consistently to after.
      if (caseIndex++ % 2) variants.reverse()
      for (const [variant, sdk] of variants) {
        const calls = []
        const converter = sdk.astrosConverter({ client })
        const originalQuote = converter.quote.bind(converter)
        converter.quote = async (req) => {
          const start = performance.now()
          const q = await originalQuote(req)
          calls.push({ request: req, quote: q, elapsedMs: performance.now() - start })
          return q
        }
        const source = {
          ...live,
          listAccountCaps: async () =>
            opening
              ? []
              : [
                  {
                    id: '0x' + 'b'.repeat(64),
                    accountOwner: '0x' + 'c'.repeat(64),
                    strategyId: strategy.id,
                    registryKey: strategy.registryKey
                  }
                ],
          // Pin prices/capacity for before/after comparison; this is not a production cache.
          readMarket: async () => ({ ...market, observedAt: Date.now() }),
          readPosition: async () => position,
          readBorrowFeeBps: async () => fee
        }
        const engine = sdk.createMultiplyClient({
          client,
          dataSource: source,
          strategies: [strategy],
          converters: [],
          fallbackConverter: converter
        })
        const row = { variant, principal, action, target, minHF, calls }
        const start = performance.now()
        try {
          const q = await engine.quote(
            owner,
            strategy,
            opening
              ? { type: 'open', amount: P.toFixed(0), targetLeverage: target }
              : { type: 'set_leverage', targetLeverage: target },
            { minHealthFactor: minHF, maxSlippageBps: 50 }
          )
          const e = q.execution
          const C = new BN(e.minCollateralAfter).times(pc),
            D = new BN(e.debtAfter).times(pd)
          const hf = C.times(market.liquidationThreshold).div(D.times(market.borrowWeight))
          assert(hf.gte(minHF), 'unsafe HF accepted')
          assert(
            withinLtv(
              { collateralAmount: e.minCollateralAfter, debtAmount: e.debtAfter },
              position,
              market,
              false
            )
          )
          assert(withinSameReserveCapacity(strategy, e, market))
          assert(new BN(e.borrowAmount).plus(e.borrowFee).lte(borrowCapacity(market)))
          assert(
            new BN(e.collateralAfter).minus(position.collateralAmount).lte(supplyCapacity(market))
          )
          validateFunding(q)
          const relative = new BN(q.estimate.leverage).div(target).minus(1).abs()
          assert(relative.lte(variant === 'before' ? '.0001' : '.001'))
          row.result = {
            leverage: q.estimate.leverage,
            worstHF: hf.toFixed(12),
            relativeErrorPercent: relative.times(100).toFixed(9),
            riskAndFundingPassed: true
          }
          row.quote = q
        } catch (e) {
          row.error = { code: e.code, message: e.message }
        }
        row.elapsedMs = performance.now() - start
        row.quoteCount = calls.length
        report.rows.push(row)
        await save()
        console.log(JSON.stringify({ ...row, calls: undefined, quote: undefined }))
      }
    }
}
assert(
  report.rows.filter((r) => ['open', 'increase'].includes(r.action)).every((r) => r.result),
  'positive case failed'
)
assert(
  report.rows
    .filter((r) => r.action === 'unsafe-open')
    .every((r) => r.error?.code === 'CONSTRAINT_VIOLATION'),
  'unsafe case accepted or unexpected error'
)
assert(
  report.rows
    .filter((r) => r.variant === 'after' && ['open', 'increase'].includes(r.action))
    .every((r) => r.quoteCount === 1),
  'positive case did not finish with one quote'
)
assert(
  report.rows
    .filter((r) => r.action === 'boundary-open')
    .every((r) => r.result?.riskAndFundingPassed || r.error?.code === 'CONSTRAINT_VIOLATION'),
  'boundary case violated risk checks or unexpected error'
)
report.passed = true
await save()
