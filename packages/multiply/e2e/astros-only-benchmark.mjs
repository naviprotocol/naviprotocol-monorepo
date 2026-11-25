// Read-only, interleaved comparisons. Synthetic positions isolate the solver.
// Real market/RPC/Astros calls; no signing/broadcast. Not an API latency benchmark.
import { performance } from 'node:perf_hooks'
import { writeFile, mkdir } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  createMultiplyClient,
  createNaviDataSource,
  createChainRateHintReader,
  voloConverter,
  haedalConverter,
  astrosConverter,
  SUI,
  VSUI,
  HASUI
} from '../dist/index.js'
import { BN } from '../dist/utils.js'
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
  acceptedInputCoinTypes: [d, c],
  collateralCoinType: c,
  debtCoinType: d
}))
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: 'https://fullnode.mainnet.sui.io:443'
})
const owner = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const out = process.env.MULTIPLY_BENCH_OUT ?? '/private/tmp/multiply-astros-evidence',
  rounds = Number(process.env.MULTIPLY_BENCH_ROUNDS ?? 10)
await mkdir(out, { recursive: true })
const report = {
  broadcast: false,
  scope:
    'SDK planner + real route/hint/fee calls, fixed market/synthetic position; excludes HTTP/discovery/market refresh.',
  variants: {
    solver: 'Astros-only original solver, no price/rate seed',
    hint: 'Astros-only price/rate seed',
    native: 'Previous native-priority snapshot path, otherwise Astros'
  },
  markets: {},
  samples: []
}
let saves = Promise.resolve()
const save = () => {
  const data = JSON.stringify(report, null, 2)
  saves = saves.then(() => writeFile(`${out}/benchmark.json`, data))
  return saves
}
await Promise.all(
  strategies.map(async (s) => {
    const live = createNaviDataSource({ client, strategies: [s] })
    let market
    try {
      market = await live.readMarket(s)
    } catch (e) {
      report.markets[s.id] = { error: e.message }
      await save()
      return
    }
    report.markets[s.id] = market
    const c = new BN(process.env.MULTIPLY_BENCH_PRINCIPAL ?? '100')
      .shiftedBy(market.collateral.token.decimals)
      .toFixed(0)
    const d = new BN(c)
      .shiftedBy(-market.collateral.token.decimals)
      .times(market.collateralPrice)
      .div(market.debtPrice)
      .div(2)
      .shiftedBy(market.debt.token.decimals)
      .integerValue(BN.ROUND_FLOOR)
      .toFixed(0)
    const raw = (n) => new BN(n).shiftedBy(market.debt.token.decimals).toFixed(0)
    const cap = {
      id: '0x' + 'b'.repeat(64),
      accountOwner: '0x' + 'c'.repeat(64),
      strategyId: s.id,
      registryKey: s.registryKey
    }
    const actions = {
      open: {
        type: 'open',
        amount: raw(process.env.MULTIPLY_BENCH_PRINCIPAL ?? '100'),
        targetLeverage: '2'
      },
      increase: { type: 'set_leverage', targetLeverage: '2.5' },
      decrease: { type: 'set_leverage', targetLeverage: '1.5' },
      withdraw: { type: 'remove_principal', amount: raw('1'), targetLeverage: '1.5' },
      clear: { type: 'set_leverage', targetLeverage: '1' },
      close: { type: 'close' },
      add: { type: 'add_principal', amount: raw('10'), targetLeverage: '2' }
    }
    const borrowFee = await live.readBorrowFeeBps(market)
    for (let round = 0; round < rounds; round++)
      for (const [name, action] of Object.entries(actions).filter(
        ([k]) =>
          !process.env.MULTIPLY_BENCH_ACTIONS ||
          process.env.MULTIPLY_BENCH_ACTIONS.split(',').includes(k)
      )) {
        const variants = round % 2 ? ['hint', 'solver', 'native'] : ['native', 'solver', 'hint']
        for (const variant of variants) {
          const row = {
            strategy: s.id,
            round,
            action: name,
            variant,
            quotes: [],
            hints: [],
            fees: []
          }
          const wrap = (converter) => {
            const q = converter.quote.bind(converter)
            converter.quote = async (req) => {
              const start = performance.now(),
                call = { provider: converter.id, input: req.amountIn }
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
            if (converter.enrichFees) {
              const fee = converter.enrichFees.bind(converter)
              converter.enrichFees = async (q) => {
                const start = performance.now()
                try {
                  return await fee(q)
                } finally {
                  row.fees.push(performance.now() - start)
                }
              }
            }
            return converter
          }
          const reader = createChainRateHintReader(client)
          const source = {
            ...live,
            listAccountCaps: async () => (name === 'open' ? [] : [cap]),
            readMarket: async () => ({ ...market, observedAt: Date.now() }),
            readPosition: async () => ({ collateralAmount: c, debtAmount: d }),
            readBorrowFeeBps: async () => borrowFee
          }
          const engine = createMultiplyClient({
            client,
            dataSource: source,
            strategies: [s],
            converters:
              variant === 'native'
                ? [wrap(voloConverter({ client })), wrap(haedalConverter({ client }))]
                : [],
            fallbackConverter: wrap(astrosConverter({ client })),
            useRateHints: variant !== 'solver',
            ...(variant === 'hint'
              ? {
                  rateHintProvider: async (pair) => {
                    const start = performance.now()
                    try {
                      const result = await reader(pair)
                      row.hintAvailable = !!result
                      return result
                    } finally {
                      row.hints.push(performance.now() - start)
                    }
                  }
                }
              : {})
          })
          const start = performance.now()
          try {
            const q = await engine.quote(owner, s, action, {
              minHealthFactor: '1.08',
              maxSlippageBps: 50
            })
            row.result = {
              leverage: q.estimate.leverage,
              hf: q.estimate.healthFactor,
              collateral: q.execution.collateralAfter,
              debt: q.execution.debtAfter,
              flash: q.execution.flashAmount,
              withdraw: q.execution.withdrawAmount,
              conversions: q.execution.conversions.map((c) => ({
                provider: c.converterId,
                input: c.input.amount,
                expected: c.expectedOutput.amount,
                min: c.minOutput.amount,
                route: c.route,
                fees: c.fees
              }))
            }
          } catch (e) {
            row.error = { code: e.code, message: e.message }
          }
          row.ms = performance.now() - start
          report.samples.push(row)
          await save()
          console.log(
            JSON.stringify({
              strategy: s.id,
              round,
              action: name,
              variant,
              calls: row.quotes.length,
              ms: Math.round(row.ms),
              error: row.error?.code
            })
          )
        }
      }
  })
)
await save()
