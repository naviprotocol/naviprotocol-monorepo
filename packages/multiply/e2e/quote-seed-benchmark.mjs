// Read-only comparison against a git-pinned baseline. Never signs or broadcasts.
// Run after `vite build` from packages/multiply: node e2e/quote-seed-benchmark.mjs
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { createMultiplyClient } from '../dist/client.js'
import { createNaviDataSource } from '../dist/data-source.js'
import { voloConverter, haedalConverter, astrosConverter } from '../dist/converters.js'
import { SUI, VSUI, HASUI } from '../dist/strategies.js'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const dist = new URL('../dist/', import.meta.url)
const baseline = process.env.MULTIPLY_BENCH_BASE ?? '0e8f2a9'
const out = process.env.MULTIPLY_BENCH_OUT ?? join(tmpdir(), 'multiply-price-seed-benchmark')
const rounds = Number(process.env.MULTIPLY_BENCH_ROUNDS ?? 3)
const principal = BigInt(process.env.MULTIPLY_BENCH_PRINCIPAL ?? '100')
const targetLeverage = process.env.MULTIPLY_BENCH_LEVERAGE ?? '2'
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('rounds must be 1..10')
await mkdir(out, { recursive: true })
const modules = await mkdtemp(join(tmpdir(), 'multiply-baseline-'))
const baselineSource = execFileSync(
  'git',
  ['show', `${baseline}:packages/multiply/src/planner.ts`],
  { cwd: root, encoding: 'utf8' }
)
const absoluteImports = (source) =>
  source.replace(/from (["'])(\.\/[^"']+)\1/g, (_all, _q, relative) => {
    const name = relative.endsWith('.js') ? relative : relative + '.js'
    return `from ${JSON.stringify(new URL(name, dist).href)}`
  })
await writeFile(
  join(modules, 'planner.mjs'),
  absoluteImports(
    ts.transpileModule(baselineSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText
  )
)
const baselineClient = absoluteImports(
  await readFile(new URL('client.js', dist), 'utf8')
).replaceAll(new URL('planner.js', dist).href, pathToFileURL(join(modules, 'planner.mjs')).href)
await writeFile(join(modules, 'client.mjs'), baselineClient)
const { createMultiplyClient: createBefore } = await import(
  pathToFileURL(join(modules, 'client.mjs')).href
)
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const USDSUI = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
// Match the API's current catalogue: haSUI uses ordinary main-market risk parameters.
const strategies = [
  ['main-vsui-sui', '4', '2', VSUI, SUI, 0],
  ['main-hasui-sui', '5', '1', HASUI, SUI, undefined],
  ['main-usdsui-usdc', '7', '2', USDSUI, USDC, 2]
].map(([id, key, version, collateral, debt, emodeId]) => ({
  id,
  market: 'main',
  registryKey: { strategyNumericId: key, strategyVersion: version },
  ...(emodeId === undefined ? {} : { emodeId }),
  principalCoinType: debt,
  acceptedInputCoinTypes: [debt, collateral],
  collateralCoinType: collateral,
  debtCoinType: debt
}))
// A public empty account for quote-only tests. No balance or signing required for a quote.
const owner = '0x' + '0'.repeat(60) + 'cafe'
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443'
})
const report = {
  baseline,
  candidate:
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() +
    '+working-tree',
  broadcast: false,
  principal: principal.toString(),
  targetLeverage,
  rounds,
  timingScope:
    'full SDK quote: live Cap, market, fee reads and live converters; excludes HTTP API/valuation/save/frontend',
  samples: []
}
report.candidateSourceSha256 = {}
for (const name of ['planner', 'converters', 'client', 'types', 'native-staking']) {
  report.candidateSourceSha256[name] = createHash('sha256')
    .update(await readFile(join(root, `packages/multiply/src/${name}.ts`)))
    .digest('hex')
}
const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2))
for (const strategy of strategies) {
  for (let round = 0; round < rounds; round++) {
    for (const variant of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      let stages = [],
        quotes = []
      const measure = async (stage, read) => {
        const start = performance.now()
        try {
          return await read()
        } finally {
          stages.push({ stage, ms: performance.now() - start })
        }
      }
      const source = createNaviDataSource({ client, strategies: [strategy], measure })
      for (const key of ['listAccountCaps', 'readMarket', 'readBorrowFeeBps']) {
        const original = source[key].bind(source)
        source[key] = (...args) => measure(key, () => original(...args))
      }
      const wrap = (converter) => {
        // Mutate this instance so a cold hint's internal probe is counted as well.
        const quote = converter.quote.bind(converter)
        const hint = converter.getRateHint?.bind(converter)
        const snapshot = converter.getStakingSnapshot?.bind(converter)
        if (snapshot)
          converter.getStakingSnapshot = (pair) =>
            measure('snapshot:' + converter.id, () => snapshot(pair))
        let readingHint = false
        converter.quote = async (req) => {
          const row = {
            provider: converter.id,
            kind: readingHint ? 'rate-probe' : 'formal',
            amount: req.amountIn
          }
          const start = performance.now()
          quotes.push(row)
          try {
            const q = await quote(req)
            row.output = q.expectedOutput.amount
            return q
          } catch (error) {
            row.error = error.code ?? error.message
            throw error
          } finally {
            row.ms = performance.now() - start
          }
        }
        if (hint)
          converter.getRateHint = async (pair) => {
            readingHint = true
            try {
              return await measure('rateHint:' + converter.id, () => hint(pair))
            } finally {
              readingHint = false
            }
          }
        return converter
      }
      const engine = (variant === 'before' ? createBefore : createMultiplyClient)({
        client,
        dataSource: source,
        strategies: [strategy],
        converters: [wrap(voloConverter({ client })), wrap(haedalConverter({ client }))],
        fallbackConverter: wrap(astrosConverter({ client }))
      })
      // The follow-up uses the same engine/provider instances and fresh market reads.
      // Slow reads may expire the 5s snapshot. Snapshot duration includes the epoch check.
      for (const mode of variant === 'before' ? ['before'] : ['after', 'after-follow-up']) {
        stages = []
        quotes = []
        const sample = { strategy: strategy.id, round: round + 1, variant: mode, stages, quotes }
        const start = performance.now()
        try {
          const q = await engine.quote(
            owner,
            strategy,
            {
              type: 'open',
              amount: (
                principal * (strategy.debtCoinType === SUI ? 10n ** 9n : 10n ** 6n)
              ).toString(),
              targetLeverage
            },
            { minHealthFactor: strategy.id.includes('hasui') ? '1.07' : '1.05', maxSlippageBps: 50 }
          )
          sample.leverage = q.estimate.leverage
          sample.healthFactor = q.estimate.healthFactor
          sample.flashAmount = q.execution.flashAmount
          sample.provider = q.execution.conversions[0]?.converterId
          sample.market = {
            collateralPrice: q.execution.market.collateralPrice,
            debtPrice: q.execution.market.debtPrice,
            flashFeeBps: q.execution.market.flash.feeBps,
            ltv: q.execution.market.ltv,
            lt: q.execution.market.liquidationThreshold
          }
          sample.status = 'passed'
        } catch (error) {
          sample.status = 'failed'
          sample.error = { code: error.code, message: error.message }
        }
        sample.ms = performance.now() - start
        sample.converterCalls = quotes.length
        sample.rateProbeCalls = quotes.filter((q) => q.kind === 'rate-probe').length
        sample.formalQuoteCalls = quotes.filter((q) => q.kind === 'formal').length
        sample.snapshotMs = stages
          .filter((s) => s.stage.startsWith('snapshot:'))
          .reduce((n, s) => n + s.ms, 0)
        sample.converterMs = quotes.reduce((sum, row) => sum + row.ms, 0)
        report.samples.push(sample)
        await save()
        console.log(JSON.stringify({ ...sample, stages: undefined, quotes: undefined }))
      }
    }
  }
}
console.log(`Evidence: ${join(out, 'report.json')}`)
