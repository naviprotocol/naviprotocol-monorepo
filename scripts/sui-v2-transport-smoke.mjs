#!/usr/bin/env node

const suiPackageRoot = new URL('../packages/lending/node_modules/@mysten/sui/', import.meta.url)
const [{ SuiGrpcClient }, { SuiGraphQLClient }, { SuiJsonRpcClient }, { Transaction }] =
  await Promise.all([
    import(new URL('./dist/grpc/index.mjs', suiPackageRoot)),
    import(new URL('./dist/graphql/index.mjs', suiPackageRoot)),
    import(new URL('./dist/jsonRpc/index.mjs', suiPackageRoot)),
    import(new URL('./dist/transactions/index.mjs', suiPackageRoot))
  ])

const DEFAULT_SUI_COIN_TYPE = '0x2::sui::SUI'

function env(name) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

function logStep(message) {
  console.log(`[sui-v2-smoke] ${message}`)
}

function logMissing(scope, keys) {
  logStep(`${scope} skipped; missing env keys: ${keys.join(', ')}`)
}

function authHeaders(tokenKey, headerKey, defaultHeaderName) {
  const token = env(tokenKey)
  if (!token) {
    return {}
  }
  const headerName = env(headerKey) ?? defaultHeaderName
  logStep(`${tokenKey} present; sending ${headerKey || defaultHeaderName} header name only`)
  return {
    [headerName]: headerName.toLowerCase() === 'authorization' ? `Bearer ${token}` : token
  }
}

async function runGrpcSmoke() {
  const endpoint = env('SUI_GRPC_ENDPOINT')
  const owner = env('SUI_SMOKE_ADDRESS')
  if (!endpoint || !owner) {
    logMissing('gRPC', [
      ...(!endpoint ? ['SUI_GRPC_ENDPOINT'] : []),
      ...(!owner ? ['SUI_SMOKE_ADDRESS'] : [])
    ])
    return
  }

  const client = new SuiGrpcClient({
    network: env('SUI_NETWORK') ?? 'mainnet',
    baseUrl: endpoint,
    fetchInit: {
      headers: authHeaders('SUI_GRPC_TOKEN', 'SUI_GRPC_HEADER_NAME', 'authorization')
    }
  })

  const balances = await client.core.listBalances({ owner, limit: 10 })
  logStep(`gRPC listBalances passed; balances=${balances.balances.length}`)

  const suiBalance = await client.core.getBalance({ owner, coinType: DEFAULT_SUI_COIN_TYPE })
  logStep(
    `gRPC getBalance passed; fields=${Object.keys(suiBalance.balance ?? {}).sort().join(',')}`
  )

  const coins = await client.core.listCoins({
    owner,
    coinType: DEFAULT_SUI_COIN_TYPE,
    limit: 1
  })
  logStep(`gRPC listCoins passed; coins=${coins.objects.length}`)

  const objectId = env('SUI_SMOKE_OBJECT_ID') ?? coins.objects[0]?.objectId
  if (objectId) {
    await client.core.getObject({ objectId, include: { type: true, owner: true } })
    logStep('gRPC getObject passed')
  } else {
    logStep('gRPC getObject skipped; no SUI_SMOKE_OBJECT_ID and no coin object')
  }

  const digest = env('SUI_SMOKE_TRANSACTION_DIGEST')
  if (digest) {
    await client.core.getTransaction({ digest, include: { effects: true, events: true } })
    logStep('gRPC getTransaction passed')
  } else {
    logStep('gRPC getTransaction skipped; missing env key: SUI_SMOKE_TRANSACTION_DIGEST')
  }

  if (!coins.objects[0]) {
    logStep('gRPC simulation skipped; no SUI coin object for gas fixture')
    return
  }

  const makeSimulationTx = () => {
    const tx = new Transaction()
    tx.setSender(owner)
    tx.setGasBudget(1_000_000)
    tx.setGasPayment([
      {
        objectId: coins.objects[0].objectId,
        version: coins.objects[0].version,
        digest: coins.objects[0].digest
      }
    ])
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
    tx.transferObjects([coin], owner)
    return tx
  }

  await client.core.simulateTransaction({
    transaction: makeSimulationTx(),
    include: {
      effects: true,
      events: true,
      balanceChanges: true
    }
  })
  logStep('gRPC simulateTransaction dry-run equivalent passed')

  await client.core.simulateTransaction({
    transaction: makeSimulationTx(),
    checksEnabled: false,
    include: {
      effects: true,
      events: true,
      commandResults: true
    }
  })
  logStep('gRPC simulateTransaction devInspect equivalent passed')
}

async function runGraphQLSmoke() {
  const url = env('SUI_GRAPHQL_URL')
  const owner = env('SUI_SMOKE_ADDRESS')
  if (!url || !owner) {
    logMissing('GraphQL', [
      ...(!url ? ['SUI_GRAPHQL_URL'] : []),
      ...(!owner ? ['SUI_SMOKE_ADDRESS'] : [])
    ])
    return
  }

  const client = new SuiGraphQLClient({
    network: env('SUI_NETWORK') ?? 'mainnet',
    url,
    headers: authHeaders('SUI_GRAPHQL_TOKEN', 'SUI_GRAPHQL_HEADER_NAME', 'authorization')
  })

  const result = await client.query({
    query: `
      query NaviSuiV2Smoke($owner: SuiAddress!) {
        address(address: $owner) {
          balances(first: 1) {
            nodes {
              totalBalance
              addressBalance
              coinBalance
              coinType {
                repr
              }
            }
          }
          transactions(first: 1) {
            nodes {
              digest
            }
          }
        }
      }
    `,
    variables: {
      owner
    }
  })

  if (result.errors?.length) {
    throw new Error(`GraphQL smoke returned ${result.errors.length} error(s)`)
  }

  logStep('GraphQL balance/history query passed')
}

async function runLegacyJsonRpcSmoke() {
  const url = env('SUI_JSON_RPC_URL')
  const owner = env('SUI_SMOKE_ADDRESS')
  if (!url || !owner) {
    logMissing('legacy JSON-RPC', [
      ...(!url ? ['SUI_JSON_RPC_URL'] : []),
      ...(!owner ? ['SUI_SMOKE_ADDRESS'] : [])
    ])
    return
  }

  const client = new SuiJsonRpcClient({
    network: env('SUI_NETWORK') ?? 'mainnet',
    url
  })

  await client.getBalance({ owner, coinType: DEFAULT_SUI_COIN_TYPE })
  logStep('legacy JSON-RPC getBalance passed')
}

async function main() {
  logStep('starting read-only provider smoke; no private keys are read and no transaction is executed')
  await runGrpcSmoke()
  await runGraphQLSmoke()
  await runLegacyJsonRpcSmoke()
  logStep('completed')
}

main().catch((error) => {
  console.error(`[sui-v2-smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
