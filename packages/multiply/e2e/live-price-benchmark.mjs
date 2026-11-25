// Read-only mainnet benchmark: `readMarket` of published 0.2.0 (serial live oracle) against this
// build (oracle preparation in parallel with the other reads). No signing or broadcast.
//
//   npm install --prefix "$BASELINE" @naviprotocol/multiply@0.2.0 @mysten/sui@2.20.2
//   pnpm --filter @naviprotocol/multiply build
//   MULTIPLY_BASELINE_DIR="$BASELINE" node e2e/live-price-benchmark.mjs
//
// Each round runs every strategy on both versions, alternating which goes first. Every sample
// records total time, each measure stage (offset and duration from the readMarket start), prices,
// `market.observedAt`, and the simulated PTB (Move call targets plus a digest of the unresolved
// commands and inputs) so the two versions' PTBs can be compared.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const baselineDir = process.env.MULTIPLY_BASELINE_DIR
if (!baselineDir) throw new Error('Set MULTIPLY_BASELINE_DIR to a directory with multiply@0.2.0')
const rounds = Number(process.env.MULTIPLY_BENCH_ROUNDS ?? 10)
const out = path.resolve(
  process.env.MULTIPLY_E2E_OUT ??
    path.join(root, 'out/multiply', `live-price-${new Date().toISOString().replace(/[:.]/g, '-')}`)
)

async function load(label, dir, entry) {
  const require = createRequire(path.join(dir, 'package.json'))
  const multiplyEntry = entry ?? require.resolve('@naviprotocol/multiply')
  const pkg = JSON.parse(
    await readFile(path.join(path.dirname(multiplyEntry), '..', 'package.json'), 'utf8')
  )
  const multiply = await import(pathToFileURL(multiplyEntry).href)
  const { SuiGrpcClient } = await import(pathToFileURL(require.resolve('@mysten/sui/grpc')).href)
  return { label, version: pkg.version, multiply, SuiGrpcClient }
}
const before = await load('before', baselineDir)
const after = await load(
  'after',
  fileURLToPath(new URL('..', import.meta.url)),
  fileURLToPath(new URL('../dist/index.js', import.meta.url))
)
if (before.version !== '0.2.0') throw new Error(`Baseline is ${before.version}, expected 0.2.0`)

const { SUI, VSUI, HASUI } = after.multiply
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const USDSUI = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
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

function instrument(impl) {
  const client = new impl.SuiGrpcClient({
    network: 'mainnet',
    baseUrl: 'https://fullnode.mainnet.sui.io:443'
  })
  const simulate = client.core.simulateTransaction.bind(client.core)
  let current
  client.core.simulateTransaction = (args) => {
    const data = args.transaction.getData()
    const ptb = JSON.stringify({ commands: data.commands, inputs: data.inputs })
    current.ptb = {
      moveCalls: data.commands.map((c) =>
        c.MoveCall ? `${c.MoveCall.package}::${c.MoveCall.module}::${c.MoveCall.function}` : c.$kind
      ),
      digest: createHash('sha256').update(ptb).digest('hex')
    }
    return simulate(args)
  }
  const source = impl.multiply.createNaviDataSource({
    client,
    strategies,
    measure: async (stage, read) => {
      const start = performance.now()
      try {
        return await read()
      } finally {
        current.stages.push({
          stage,
          startMs: +(start - current.t0).toFixed(1),
          durationMs: +(performance.now() - start).toFixed(1)
        })
      }
    }
  })
  return async (strategy) => {
    current = { t0: performance.now(), stages: [] }
    const startedAt = Date.now()
    try {
      const market = await source.readMarket(strategy)
      return {
        startedAt,
        totalMs: +(performance.now() - current.t0).toFixed(1),
        stages: current.stages,
        collateralPrice: market.collateralPrice,
        debtPrice: market.debtPrice,
        ratio: String(Number(market.collateralPrice) / Number(market.debtPrice)),
        observedAt: market.observedAt,
        observedAtMinusStart: market.observedAt - startedAt,
        ptb: current.ptb
      }
    } catch (error) {
      return {
        startedAt,
        totalMs: +(performance.now() - current.t0).toFixed(1),
        stages: current.stages,
        error: String(error?.message ?? error)
      }
    }
  }
}
const run = { before: instrument(before), after: instrument(after) }

const samples = []
for (let round = 0; round < rounds; round++) {
  for (const strategy of strategies) {
    const order = round % 2 ? ['after', 'before'] : ['before', 'after']
    for (const label of order) {
      const sample = { round, strategy: strategy.id, impl: label, ...(await run[label](strategy)) }
      samples.push(sample)
      console.log(
        `${round} ${strategy.id.padEnd(17)} ${label.padEnd(6)} ${String(sample.totalMs).padStart(7)} ms`,
        sample.error ?? `${sample.collateralPrice}/${sample.debtPrice}`
      )
    }
  }
}

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return {
    n: s.length,
    min: s[0],
    median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2,
    p90: q(0.9),
    max: s[s.length - 1],
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)
  }
}
const summary = strategies.map(({ id }) => {
  const of = (label) => samples.filter((s) => s.strategy === id && s.impl === label && !s.error)
  const byImpl = Object.fromEntries(
    ['before', 'after'].map((label) => {
      const ok = of(label)
      const stages = [...new Set(ok.flatMap((s) => s.stages.map((x) => x.stage)))]
      return [
        label,
        {
          errors: samples.filter((s) => s.strategy === id && s.impl === label && s.error).length,
          totalMs: stat(ok.map((s) => s.totalMs)),
          stageMedians: Object.fromEntries(
            stages.map((stage) => {
              const xs = ok.flatMap((s) => s.stages.filter((x) => x.stage === stage))
              return [
                stage,
                {
                  startMs: stat(xs.map((x) => x.startMs)).median,
                  durationMs: stat(xs.map((x) => x.durationMs)).median
                }
              ]
            })
          )
        }
      ]
    })
  )
  const pairs = [...Array(rounds).keys()]
    .map((round) =>
      ['before', 'after'].map((impl) =>
        samples.find((s) => s.strategy === id && s.round === round && s.impl === impl)
      )
    )
    .filter(([b, a]) => !b.error && !a.error)
  return {
    strategy: id,
    ...byImpl,
    medianSpeedupMs: +(byImpl.before.totalMs.median - byImpl.after.totalMs.median).toFixed(1),
    pairs: pairs.length,
    samePtbDigest: pairs.filter(([b, a]) => b.ptb.digest === a.ptb.digest).length,
    sameMoveCalls: pairs.filter(
      ([b, a]) => JSON.stringify(b.ptb.moveCalls) === JSON.stringify(a.ptb.moveCalls)
    ).length,
    maxPairRatioDiffBps: Math.max(
      ...pairs.map(([b, a]) => Math.abs(Number(a.ratio) / Number(b.ratio) - 1) * 1e4)
    ).toFixed(3)
  }
})

const report = {
  kind: 'mainnet-readmarket-live-price-benchmark',
  broadcast: false,
  finishedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty:
    execFileSync('git', ['status', '--porcelain', 'packages/multiply/src'], {
      cwd: root,
      encoding: 'utf8'
    }).trim() !== '',
  node: process.version,
  versions: { before: before.version, after: after.version },
  rpc: 'https://fullnode.mainnet.sui.io:443',
  rounds,
  summary,
  samples
}
await mkdir(out, { recursive: true })
await writeFile(path.join(out, 'live-price-benchmark.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
console.log(`wrote ${path.join(out, 'live-price-benchmark.json')}`)
