#!/usr/bin/env node

const suiPackageRoot = new URL('../packages/lending/node_modules/@mysten/sui/', import.meta.url)
const [
  { GrpcWebFetchTransport, SuiGrpcClient },
  { SuiGraphQLClient },
  { SuiJsonRpcClient },
  { Transaction }
] = await Promise.all([
  import(new URL('./dist/grpc/index.mjs', suiPackageRoot)),
  import(new URL('./dist/graphql/index.mjs', suiPackageRoot)),
  import(new URL('./dist/jsonRpc/index.mjs', suiPackageRoot)),
  import(new URL('./dist/transactions/index.mjs', suiPackageRoot))
])

const SUI = '0x2::sui::SUI'
const DEFAULT_OWNER = '0x439f285f559997df4b4ad42c282581b1ca991631ab020a29c8031a0849b7e30f'

function env(name) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

function envInt(name, fallback) {
  const value = env(name)
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

function normalizeGrpcBaseUrl(endpoint) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)
    ? endpoint
    : `https://${endpoint.replace(/\/+$/, '')}`
}

function tokenHeaders(tokenKey, headerKey, defaultHeaderName) {
  const token = env(tokenKey)
  if (!token) return {}
  const headerName = env(headerKey) ?? defaultHeaderName
  console.log(
    `[sdk-transport-benchmark] ${tokenKey} present; using header name ${headerName}, value redacted`
  )
  return {
    [headerName]: headerName.toLowerCase() === 'authorization' ? `Bearer ${token}` : token
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(samples) {
  const ok = samples.filter((sample) => sample.ok)
  const failed = samples.filter((sample) => !sample.ok)
  const values = ok.map((sample) => sample.ms).sort((a, b) => a - b)
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    ok: ok.length,
    failed: failed.length,
    avgMs: values.length ? Number((sum / values.length).toFixed(1)) : null,
    p50Ms: values.length ? Number(percentile(values, 50).toFixed(1)) : null,
    p95Ms: values.length ? Number(percentile(values, 95).toFixed(1)) : null,
    minMs: values.length ? Number(values[0].toFixed(1)) : null,
    maxMs: values.length ? Number(values[values.length - 1].toFixed(1)) : null,
    errors: [...new Set(failed.map((sample) => sample.error).filter(Boolean))].slice(0, 3)
  }
}

async function timed(fn) {
  const start = performance.now()
  try {
    await fn()
    return { ok: true, ms: performance.now() - start }
  } catch (error) {
    return {
      ok: false,
      ms: performance.now() - start,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runSequential(fn, iterations) {
  const samples = []
  for (let i = 0; i < iterations; i += 1) {
    samples.push(await timed(fn))
  }
  return samples
}

async function runConcurrent(fn, iterations, concurrency) {
  const samples = []
  let next = 0
  async function worker() {
    while (next < iterations) {
      next += 1
      samples.push(await timed(fn))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return samples
}

async function warmup(name, fn, iterations) {
  for (let i = 0; i < iterations; i += 1) {
    const result = await timed(fn)
    if (!result.ok) {
      throw new Error(`${name} warmup failed: ${result.error}`)
    }
  }
}

function printTable(rows) {
  const widths = {
    case: Math.max('case'.length, ...rows.map((row) => row.case.length)),
    transport: Math.max('transport'.length, ...rows.map((row) => row.transport.length)),
    mode: Math.max('mode'.length, ...rows.map((row) => row.mode.length))
  }
  console.log(
    [
      'case'.padEnd(widths.case),
      'transport'.padEnd(widths.transport),
      'mode'.padEnd(widths.mode),
      'ok',
      'fail',
      'avg',
      'p50',
      'p95',
      'min',
      'max'
    ].join('  ')
  )
  for (const row of rows) {
    console.log(
      [
        row.case.padEnd(widths.case),
        row.transport.padEnd(widths.transport),
        row.mode.padEnd(widths.mode),
        String(row.ok).padStart(2),
        String(row.failed).padStart(4),
        String(row.avgMs).padStart(6),
        String(row.p50Ms).padStart(6),
        String(row.p95Ms).padStart(6),
        String(row.minMs).padStart(6),
        String(row.maxMs).padStart(6)
      ].join('  ')
    )
  }
}

function compareAgainstJsonRpc(results) {
  const groups = new Map()
  for (const row of results) {
    const key = `${row.case}:${row.mode}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  return [...groups.values()]
    .map((rows) => {
      const jsonRpc = rows.find((row) => row.transport === 'jsonRpc')
      if (!jsonRpc?.p50Ms) return []
      return rows
        .filter((row) => row.transport !== 'jsonRpc' && row.p50Ms)
        .map((row) => ({
          case: row.case,
          mode: row.mode,
          transport: row.transport,
          jsonRpcP50Ms: jsonRpc.p50Ms,
          p50Ms: row.p50Ms,
          ratio: Number((row.p50Ms / jsonRpc.p50Ms).toFixed(2))
        }))
    })
    .flat()
}

async function main() {
  const network = env('SUI_NETWORK') ?? 'mainnet'
  const owner = env('SUI_SMOKE_ADDRESS') ?? DEFAULT_OWNER
  const grpcEndpoint = env('SUI_GRPC_ENDPOINT') ?? 'fullnode.mainnet.sui.io:443'
  const jsonRpcUrl = env('SUI_JSON_RPC_URL') ?? 'https://fullnode.mainnet.sui.io:443'
  const graphqlUrl = env('SUI_GRAPHQL_URL') ?? 'https://graphql.mainnet.sui.io/graphql'
  const iterations = envInt('NAVI_BENCH_ITERATIONS', 12)
  const concurrentIterations = envInt('NAVI_BENCH_CONCURRENT_ITERATIONS', 20)
  const concurrency = envInt('NAVI_BENCH_CONCURRENCY', 5)
  const warmupIterations = envInt('NAVI_BENCH_WARMUP', 2)
  const digest = env('SUI_SMOKE_TRANSACTION_DIGEST')

  const grpc = new SuiGrpcClient({
    network,
    transport: new GrpcWebFetchTransport({
      baseUrl: normalizeGrpcBaseUrl(grpcEndpoint),
      meta: tokenHeaders('SUI_GRPC_TOKEN', 'SUI_GRPC_HEADER_NAME', 'authorization')
    })
  })
  const jsonRpc = new SuiJsonRpcClient({ network, url: jsonRpcUrl })
  const graphql = new SuiGraphQLClient({
    network,
    url: graphqlUrl,
    headers: tokenHeaders('SUI_GRAPHQL_TOKEN', 'SUI_GRAPHQL_HEADER_NAME', 'authorization')
  })

  console.log(
    '[sdk-transport-benchmark] starting; no private keys are read and no transaction is executed'
  )
  console.log(
    JSON.stringify(
      {
        network,
        owner,
        transports: {
          grpc: normalizeGrpcBaseUrl(grpcEndpoint),
          jsonRpc: jsonRpcUrl,
          graphql: graphqlUrl
        },
        iterations,
        concurrentIterations,
        concurrency,
        warmupIterations,
        transactionDigest: digest ? 'present' : 'missing'
      },
      null,
      2
    )
  )

  const coinPage = await grpc.core.listCoins({ owner, coinType: SUI, limit: 20 })
  const objectIds = coinPage.objects
    .map((coin) => coin.objectId)
    .filter(Boolean)
    .slice(0, 3)
  if (!objectIds[0]) {
    throw new Error('Benchmark owner must have at least one SUI coin object')
  }
  const gasBudget = 10_000_000n
  const gasCoin = coinPage.objects.find((coin) => BigInt(coin.balance ?? '0') > gasBudget + 1n)
  if (!gasCoin) {
    throw new Error('Benchmark owner must have a SUI coin object large enough for simulation gas')
  }

  const tx = new Transaction()
  tx.setSender(owner)
  tx.setGasBudget(Number(gasBudget))
  tx.setGasPayment([
    {
      objectId: gasCoin.objectId,
      version: gasCoin.version,
      digest: gasCoin.digest
    }
  ])
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
  tx.transferObjects([coin], owner)
  const txBytes = await tx.build({ client: grpc })

  const cases = [
    {
      case: 'balance.sui',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.getBalance({ owner, coinType: SUI }) },
        { transport: 'jsonRpc', fn: () => jsonRpc.getBalance({ owner, coinType: SUI }) },
        { transport: 'graphql', fn: () => graphql.core.getBalance({ owner, coinType: SUI }) }
      ]
    },
    {
      case: 'balances.list',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.listBalances({ owner, limit: 20 }) },
        { transport: 'jsonRpc', fn: () => jsonRpc.getAllBalances({ owner }) },
        { transport: 'graphql', fn: () => graphql.core.listBalances({ owner, limit: 20 }) }
      ]
    },
    {
      case: 'coins.sui.limit5',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.listCoins({ owner, coinType: SUI, limit: 5 }) },
        { transport: 'jsonRpc', fn: () => jsonRpc.getCoins({ owner, coinType: SUI, limit: 5 }) },
        {
          transport: 'graphql',
          fn: () => graphql.core.listCoins({ owner, coinType: SUI, limit: 5 })
        }
      ]
    },
    {
      case: 'ownedObjects.limit10',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.listOwnedObjects({ owner, limit: 10 }) },
        {
          transport: 'jsonRpc',
          fn: () => jsonRpc.getOwnedObjects({ owner, limit: 10, options: { showType: true } })
        },
        { transport: 'graphql', fn: () => graphql.core.listOwnedObjects({ owner, limit: 10 }) }
      ]
    },
    {
      case: 'object.single',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.getObject({ objectId: objectIds[0] }) },
        {
          transport: 'jsonRpc',
          fn: () =>
            jsonRpc.getObject({ id: objectIds[0], options: { showType: true, showOwner: true } })
        },
        { transport: 'graphql', fn: () => graphql.core.getObject({ objectId: objectIds[0] }) }
      ]
    },
    {
      case: 'objects.multi',
      variants: [
        { transport: 'grpc', fn: () => grpc.core.getObjects({ objectIds }) },
        {
          transport: 'jsonRpc',
          fn: () =>
            jsonRpc.multiGetObjects({
              ids: objectIds,
              options: { showType: true, showOwner: true }
            })
        },
        { transport: 'graphql', fn: () => graphql.core.getObjects({ objectIds }) }
      ]
    },
    {
      case: 'simulate.selfTransfer',
      variants: [
        {
          transport: 'grpc',
          fn: () =>
            grpc.core.simulateTransaction({
              transaction: txBytes,
              include: { effects: true, events: true, balanceChanges: true }
            })
        },
        {
          transport: 'jsonRpc',
          fn: () => jsonRpc.dryRunTransactionBlock({ transactionBlock: txBytes })
        },
        {
          transport: 'graphql',
          fn: () =>
            graphql.core.simulateTransaction({
              transaction: txBytes,
              include: { effects: true, events: true, balanceChanges: true }
            })
        }
      ]
    },
    {
      case: 'graphql.history',
      variants: [
        {
          transport: 'graphql',
          fn: () =>
            graphql.query({
              query: `
                query NaviSdkTransportBench($owner: SuiAddress!) {
                  address(address: $owner) {
                    transactions(first: 5) {
                      nodes { digest }
                    }
                  }
                }
              `,
              variables: { owner }
            })
        }
      ]
    }
  ]

  if (digest) {
    cases.push({
      case: 'transaction.effects',
      variants: [
        {
          transport: 'grpc',
          fn: () => grpc.core.getTransaction({ digest, include: { effects: true } })
        },
        {
          transport: 'jsonRpc',
          fn: () => jsonRpc.getTransactionBlock({ digest, options: { showEffects: true } })
        },
        {
          transport: 'graphql',
          fn: () => graphql.core.getTransaction({ digest, include: { effects: true } })
        }
      ]
    })
  }

  const rows = []
  for (const benchCase of cases) {
    for (const variant of benchCase.variants) {
      const name = `${benchCase.case}:${variant.transport}`
      await warmup(name, variant.fn, warmupIterations)
      const sequential = summarize(await runSequential(variant.fn, iterations))
      rows.push({
        case: benchCase.case,
        transport: variant.transport,
        mode: 'seq',
        ...sequential
      })

      const concurrent = summarize(
        await runConcurrent(variant.fn, concurrentIterations, concurrency)
      )
      rows.push({
        case: benchCase.case,
        transport: variant.transport,
        mode: `c${concurrency}`,
        ...concurrent
      })
    }
  }

  printTable(rows)
  console.log('\nratio_vs_jsonRpc_p50')
  console.log(JSON.stringify(compareAgainstJsonRpc(rows), null, 2))
  console.log('\njson')
  console.log(JSON.stringify({ rows }, null, 2))
}

main().catch((error) => {
  console.error(
    `[sdk-transport-benchmark] failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
