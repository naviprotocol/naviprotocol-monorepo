#!/usr/bin/env node

const suiPackageRoot = new URL('../packages/lending/node_modules/@mysten/sui/', import.meta.url)
const [
  { SuiGrpcClient },
  { SuiGraphQLClient },
  { SuiJsonRpcClient },
  { Ed25519Keypair },
  { Transaction },
  { fromBase64 }
] = await Promise.all([
  import(new URL('./dist/grpc/index.mjs', suiPackageRoot)),
  import(new URL('./dist/graphql/index.mjs', suiPackageRoot)),
  import(new URL('./dist/jsonRpc/index.mjs', suiPackageRoot)),
  import(new URL('./dist/keypairs/ed25519/index.mjs', suiPackageRoot)),
  import(new URL('./dist/transactions/index.mjs', suiPackageRoot)),
  import(new URL('./dist/utils/index.mjs', suiPackageRoot))
])

const SUI = '0x2::sui::SUI'
const NAVX = '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
const SUI_CHAIN_ID = 1999

function arg(name) {
  const prefix = `${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : undefined
}

function hasFlag(name) {
  return process.argv.includes(name)
}

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

function envAmount(name, fallback) {
  const value = env(name)
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return value
}

function envBoolean(name) {
  return env(name) === '1'
}

function normalizeGrpcBaseUrl(endpoint) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)
    ? endpoint
    : `https://${endpoint.replace(/\/+$/, '')}`
}

function log(message) {
  console.log(`[sdk-core-live] ${message}`)
}

function tokenHeaders(tokenKey, headerKey, defaultHeaderName) {
  const token = env(tokenKey)
  if (!token) return undefined
  const headerName = env(headerKey) ?? defaultHeaderName
  log(`${tokenKey} present; using header name ${headerName}, value redacted`)
  return {
    [headerName]: headerName.toLowerCase() === 'authorization' ? `Bearer ${token}` : token
  }
}

function requireEnv(name) {
  const value = env(name)
  if (!value) {
    throw new Error(`Missing required env key: ${name}`)
  }
  return value
}

function importPackage(packageName) {
  const url = new URL(`../packages/${packageName}/dist/index.esm.js`, import.meta.url)
  return import(url)
}

function mode() {
  if (hasFlag('--execute')) return 'execute'
  if (hasFlag('--plan')) return 'plan'
  return arg('--mode') ?? 'simulate'
}

function selectedScopes() {
  const only = arg('--only') ?? env('NAVI_SMOKE_ONLY')
  if (!only) {
    return new Set(['transport', 'wallet', 'lending', 'aggregator', 'dca', 'bridge'])
  }
  return new Set(
    only
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function assertBuiltPackages() {
  // Importing dist modules is intentional: this smoke validates published output,
  // not just TypeScript source. Missing dist means the release build gate was skipped.
  return Promise.all([
    importPackage('lending'),
    importPackage('wallet-client'),
    importPackage('astros-aggregator-sdk'),
    importPackage('astros-dca-sdk'),
    importPackage('astros-bridge-sdk')
  ])
}

function getWallet() {
  const privateKey = requireEnv('FE_E2E_SUI_PRIVATE_KEY')
  const keypair = Ed25519Keypair.fromSecretKey(privateKey)
  return {
    keypair,
    address: keypair.getPublicKey().toSuiAddress()
  }
}

function getClients() {
  const network = env('SUI_NETWORK') ?? 'mainnet'
  const grpcEndpoint = normalizeGrpcBaseUrl(requireEnv('SUI_GRPC_ENDPOINT'))
  const grpcHeaders = tokenHeaders('SUI_GRPC_TOKEN', 'SUI_GRPC_HEADER_NAME', 'authorization')
  const graphqlUrl = env('SUI_GRAPHQL_URL')
  const legacyJsonRpcUrl = env('SUI_JSON_RPC_URL')

  const grpc = new SuiGrpcClient({
    network,
    baseUrl: grpcEndpoint,
    fetchInit: grpcHeaders ? { headers: grpcHeaders } : undefined
  })
  const graphql = graphqlUrl
    ? new SuiGraphQLClient({
        network,
        url: graphqlUrl,
        headers: tokenHeaders('SUI_GRAPHQL_TOKEN', 'SUI_GRAPHQL_HEADER_NAME', 'authorization')
      })
    : undefined
  const legacyJsonRpc = legacyJsonRpcUrl
    ? new SuiJsonRpcClient({
        network,
        url: legacyJsonRpcUrl
      })
    : undefined

  return {
    network,
    grpc,
    graphql,
    legacyJsonRpc,
    grpcEndpoint,
    graphqlUrl,
    legacyJsonRpcUrl
  }
}

function makeNaviClientOptions(clients) {
  return {
    network: clients.network,
    grpc: {
      client: clients.grpc
    },
    ...(clients.graphql
      ? {
          graphql: {
            client: clients.graphql
          }
        }
      : {}),
    ...(clients.legacyJsonRpc
      ? {
          legacyJsonRpc: {
            client: clients.legacyJsonRpc
          }
        }
      : {}),
    ...(env('NAVI_OPEN_API_BASE_URL')
      ? {
          services: {
            naviOpenApi: {
              baseUrl: env('NAVI_OPEN_API_BASE_URL')
            }
          }
        }
      : {})
  }
}

function getStatus(result) {
  const tx = result?.Transaction ?? result
  const failed = result?.FailedTransaction
  if (failed) return { success: false, digest: failed.digest, error: failed.status?.error }
  const status = tx?.status ?? tx?.effects?.status
  if (status?.success === false || status?.status === 'failure') {
    return { success: false, digest: tx?.digest, error: status.error }
  }
  return {
    success: true,
    digest: tx?.digest,
    error: status?.error ?? null
  }
}

function assertSuccess(result, label) {
  const status = getStatus(result)
  if (!status.success) {
    throw new Error(`${label} failed${status.error ? `: ${status.error}` : ''}`)
  }
  return status
}

async function simulateTransaction(client, tx, label) {
  const result = await client.core.simulateTransaction({
    transaction: tx,
    include: {
      effects: true,
      events: true,
      balanceChanges: true,
      objectTypes: true
    }
  })
  assertSuccess(result, `${label} simulate`)
  return result
}

async function executeTransaction(client, keypair, tx, label, address) {
  tx.setSenderIfNotSet(address)
  const txBytes = await tx.build({ client })
  const signed = await keypair.signTransaction(txBytes)
  const result = await client.core.executeTransaction({
    transaction: fromBase64(signed.bytes),
    signatures: [signed.signature],
    include: {
      effects: true,
      events: true,
      balanceChanges: true,
      objectTypes: true
    }
  })
  const status = assertSuccess(result, `${label} execute`)
  return { result, status }
}

function selfTransferTx(address, amountMist) {
  const tx = new Transaction()
  tx.setSender(address)
  const [coin] = tx.splitCoins(tx.gas, [amountMist])
  tx.transferObjects([coin], address)
  return tx
}

async function runStep(summary, name, fn, { optional = false } = {}) {
  const startedAt = Date.now()
  try {
    const result = await fn()
    const durationMs = Date.now() - startedAt
    summary.steps.push({ name, status: 'passed', durationMs, result })
    log(`${name} passed (${durationMs}ms)`)
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    summary.steps.push({
      name,
      status: optional ? 'skipped' : 'failed',
      durationMs,
      error: message
    })
    log(`${name} ${optional ? 'skipped' : 'failed'}: ${message}`)
    if (!optional) throw error
    return undefined
  }
}

async function runTransportSmoke(summary, clients, address) {
  await runStep(summary, 'transport.grpc.listBalances/getBalance/listCoins', async () => {
    const [balances, balance, coins] = await Promise.all([
      clients.grpc.core.listBalances({ owner: address, limit: 10 }),
      clients.grpc.core.getBalance({ owner: address, coinType: SUI }),
      clients.grpc.core.listCoins({ owner: address, coinType: SUI, limit: 1 })
    ])
    return {
      balances: balances.balances?.length ?? 0,
      totalBalance:
        balance.balance?.totalBalance ?? balance.balance?.balance ?? balance.totalBalance,
      coinObjects: coins.objects?.length ?? 0
    }
  })

  await runStep(
    summary,
    'transport.graphql.balance/history',
    async () => {
      if (!clients.graphql) {
        throw new Error('missing SUI_GRAPHQL_URL')
      }
      const result = await clients.graphql.query({
        query: `
          query NaviSdkCoreSmoke($owner: SuiAddress!) {
            address(address: $owner) {
              balances(first: 1) {
                nodes {
                  totalBalance
                  addressBalance
                  coinBalance
                  coinType { repr }
                }
              }
              transactions(first: 1) {
                nodes { digest }
              }
            }
          }
        `,
        variables: { owner: address }
      })
      if (result.errors?.length) {
        throw new Error(`GraphQL returned ${result.errors.length} error(s)`)
      }
      return { balances: result.data?.address?.balances?.nodes?.length ?? 0 }
    },
    { optional: !clients.graphql }
  )

  await runStep(
    summary,
    'transport.legacyJsonRpc.explicit.getBalance',
    async () => {
      if (!clients.legacyJsonRpc) {
        throw new Error('missing SUI_JSON_RPC_URL')
      }
      const result = await clients.legacyJsonRpc.getBalance({ owner: address, coinType: SUI })
      return { totalBalance: result.totalBalance }
    },
    { optional: !clients.legacyJsonRpc }
  )
}

async function runWalletSmoke(summary, packages, clients, wallet, smokeMode) {
  const { WalletClient } = packages.wallet
  const amount = envInt('NAVI_SMOKE_TRANSFER_MIST', 1)
  const walletClient = new WalletClient({
    signer: wallet.keypair,
    configs: {
      balance: {
        disableCoinPolling: true
      }
    },
    client: makeNaviClientOptions(clients)
  })

  await runStep(summary, 'wallet-client.self-transfer.simulate', async () => {
    const tx = selfTransferTx(wallet.address, amount)
    const result = await walletClient.signExecuteTransaction({ transaction: tx, dryRun: true })
    if (result.effects?.status?.status === 'failure') {
      throw new Error(result.effects.status.error ?? 'dry-run failed')
    }
    return { amountMist: amount, events: result.events?.length ?? 0 }
  })

  if (smokeMode === 'execute') {
    await runStep(summary, 'wallet-client.self-transfer.execute', async () => {
      const tx = selfTransferTx(wallet.address, amount)
      const result = await walletClient.signExecuteTransaction({ transaction: tx, dryRun: false })
      if (result.effects?.status?.status === 'failure') {
        throw new Error(result.effects.status.error ?? 'execute failed')
      }
      return { amountMist: amount, digest: result.digest }
    })
  }
}

async function runLendingSmoke(summary, packages, clients, wallet, smokeMode) {
  const { depositCoinPTB, getPools, getPriceFeeds, updateOraclePricesPTB } = packages.lending
  const amount = envInt('NAVI_SMOKE_LENDING_DEPOSIT_MIST', 10_000_000)

  await runStep(summary, 'lending.read.pools', async () => {
    const pools = await getPools()
    return { pools: pools.length }
  })

  const buildDepositTx = async () => {
    const tx = new Transaction()
    tx.setSender(wallet.address)
    const feeds = await getPriceFeeds()
    await updateOraclePricesPTB(tx, feeds)
    const [coin] = tx.splitCoins(tx.gas, [amount])
    await depositCoinPTB(tx, SUI, coin, { amount })
    return tx
  }

  await runStep(summary, 'lending.deposit.simulate', async () => {
    const tx = await buildDepositTx()
    const result = await simulateTransaction(clients.grpc, tx, 'lending.deposit')
    return { amountMist: amount, events: result.Transaction?.events?.length ?? 0 }
  })

  if (smokeMode === 'execute') {
    await runStep(summary, 'lending.deposit.execute', async () => {
      const tx = await buildDepositTx()
      const { status } = await executeTransaction(
        clients.grpc,
        wallet.keypair,
        tx,
        'lending.deposit',
        wallet.address
      )
      return { amountMist: amount, digest: status.digest }
    })
  }
}

async function runAggregatorSmoke(summary, packages, clients, wallet, smokeMode) {
  const { buildSwapPTBFromQuote, dryRunSwapTransaction, executeTransaction, getQuote } =
    packages.aggregator
  const amount = envInt('NAVI_SMOKE_SWAP_MIST', 10_000_000)
  const toCoin = env('NAVI_SMOKE_SWAP_TO_COIN') ?? NAVX
  const apiKey = env('NAVI_AGGREGATOR_API_KEY') ?? env('API_KEY')

  const buildSwapTx = async () => {
    const quote = await getQuote(SUI, toCoin, amount, apiKey, {
      baseUrl: env('NAVI_AGGREGATOR_BASE_URL'),
      depth: Number(env('NAVI_SMOKE_SWAP_DEPTH') ?? 3),
      byAmountIn: true
    })
    const tx = new Transaction()
    tx.setSender(wallet.address)
    const [coinIn] = tx.splitCoins(tx.gas, [amount])
    const minAmountOut = quote.amount_out ? Number((BigInt(quote.amount_out) * 99n) / 100n) : 0
    const coinOut = await buildSwapPTBFromQuote(
      wallet.address,
      tx,
      minAmountOut,
      coinIn,
      quote,
      0,
      false,
      apiKey,
      {
        baseUrl: env('NAVI_AGGREGATOR_BASE_URL'),
        depth: Number(env('NAVI_SMOKE_SWAP_DEPTH') ?? 3),
        byAmountIn: true
      }
    )
    tx.transferObjects([coinOut], wallet.address)
    return { tx, quote }
  }

  await runStep(summary, 'astros-aggregator.swap.simulate', async () => {
    const { tx, quote } = await buildSwapTx()
    const result = await dryRunSwapTransaction(tx, { client: clients.grpc })
    if (result.effects?.status?.status === 'failure') {
      throw new Error(result.effects.status.error ?? 'dry-run failed')
    }
    return { amountMist: amount, amountOut: quote.amount_out, routes: quote.routes?.length ?? 0 }
  })

  if (smokeMode === 'execute') {
    await runStep(summary, 'astros-aggregator.swap.execute', async () => {
      const { tx, quote } = await buildSwapTx()
      const result = await executeTransaction(tx, wallet.keypair, { client: clients.grpc })
      if (result.effects?.status?.status === 'failure') {
        throw new Error(result.effects.status.error ?? 'execute failed')
      }
      return { amountMist: amount, amountOut: quote.amount_out, digest: result.digest }
    })
  }
}

async function runDcaSmoke(summary, packages, clients, wallet, smokeMode) {
  const { createDcaOrder, dryRunDcaTransaction, TimeUnit } = packages.dca
  const amount = envInt('NAVI_SMOKE_DCA_MIST', 10_000_000)
  const toCoin = env('NAVI_SMOKE_DCA_TO_COIN') ?? NAVX

  const buildDcaTx = async () => {
    const tx = await createDcaOrder(clients.grpc, wallet.address, {
      fromCoinType: SUI,
      toCoinType: toCoin,
      depositedAmount: String(amount),
      frequency: { value: 1, unit: TimeUnit.MINUTE },
      totalExecutions: 2
    })
    tx.setSender(wallet.address)
    return tx
  }

  await runStep(summary, 'astros-dca.create-order.simulate', async () => {
    const tx = await buildDcaTx()
    const result = await dryRunDcaTransaction(tx, { client: clients.grpc })
    if (result.effects?.status?.status === 'failure') {
      throw new Error(result.effects.status.error ?? 'dry-run failed')
    }
    return { amountMist: amount, events: result.events.length }
  })

  if (smokeMode === 'execute') {
    await runStep(summary, 'astros-dca.create-order.execute', async () => {
      const tx = await buildDcaTx()
      const { status } = await executeTransaction(
        clients.grpc,
        wallet.keypair,
        tx,
        'astros-dca.create-order',
        wallet.address
      )
      return { amountMist: amount, digest: status.digest }
    })
  }
}

async function runBridgeSmoke(summary, packages, clients, wallet, smokeMode) {
  const { config, getSupportTokens, getQuote, swap } = packages.bridge

  if (typeof config === 'function') {
    config({
      ...(env('NAVI_BRIDGE_BASE_URL') ? { baseUrl: env('NAVI_BRIDGE_BASE_URL') } : {}),
      ...(env('NAVI_BRIDGE_API_KEY') ? { apiKey: env('NAVI_BRIDGE_API_KEY') } : {})
    })
    if (env('NAVI_BRIDGE_API_KEY')) {
      log('NAVI_BRIDGE_API_KEY present; bridge API key value redacted')
    }
  }

  const buildQuote = async () => {
    const fromChain = SUI_CHAIN_ID
    const toChain = Number(env('NAVI_SMOKE_BRIDGE_TO_CHAIN') ?? 42161)
    const [fromTokens, toTokens] = await Promise.all([
      getSupportTokens(fromChain, 1, 20),
      getSupportTokens(toChain, 1, 20)
    ])
    const fromToken =
      fromTokens.find((token) => token.address === SUI) ??
      fromTokens.find((token) => token.symbol?.toUpperCase() === 'SUI')
    const toTokenAddress = env('NAVI_SMOKE_BRIDGE_TO_TOKEN')
    const toToken = toTokenAddress
      ? toTokens.find((token) => token.address === toTokenAddress)
      : (toTokens.find((token) => token.symbol?.toUpperCase() === 'USDC') ?? toTokens[0])

    if (!fromToken) {
      throw new Error('No bridge SUI source token available')
    }
    if (!toToken) {
      throw new Error('No bridge target token available')
    }

    const amount = envAmount('NAVI_SMOKE_BRIDGE_AMOUNT', '1')
    const quote = await getQuote(fromToken, toToken, amount, {
      slippageBps: Number(env('NAVI_SMOKE_BRIDGE_SLIPPAGE_BPS') ?? 50)
    })
    const route = quote.routes?.[0]
    if (!route) {
      throw new Error('No bridge route available')
    }
    return { amount, fromToken, toToken, quote, route }
  }

  const runSuiSourceSwap = async (provider) => {
    const { route, toToken } = await buildQuote()
    const destinationAddress = env('NAVI_SMOKE_BRIDGE_TO_ADDRESS')
    if (!destinationAddress && toToken.chainId !== SUI_CHAIN_ID) {
      throw new Error(
        'NAVI_SMOKE_BRIDGE_TO_ADDRESS is required for non-Sui bridge build/sign validation'
      )
    }
    const gasBudget = envInt('NAVI_SMOKE_BRIDGE_GAS_BUDGET', 0)
    return swap(route, wallet.address, destinationAddress ?? wallet.address, {
      sui: {
        provider,
        ...(gasBudget > 0 ? { gasBudget } : {}),
        signTransaction: async ({ transaction }) => {
          const txBytes = await transaction.build({ client: clients.grpc })
          return wallet.keypair.signTransaction(txBytes)
        }
      }
    })
  }

  await runStep(summary, 'astros-bridge.tokens.quote', async () => {
    const { amount, quote, route, toToken } = await buildQuote()
    return {
      amount,
      routes: quote.routes?.length ?? 0,
      provider: route.provider,
      amountOut: route.amount_out,
      target: `${toToken.chainId}:${toToken.symbol}`
    }
  })

  if (env('NAVI_SMOKE_BRIDGE_BUILD_SIGN') === '1') {
    await runStep(summary, 'astros-bridge.sui-source.build-sign.simulate', async () => {
      const captured = {
        bytesLength: 0,
        signatures: 0
      }
      const dryProvider = {
        network: clients.network,
        core: clients.grpc.core,
        executeTransaction: async ({ transaction, signatures, include }) => {
          captured.bytesLength = transaction?.byteLength ?? transaction?.length ?? 0
          captured.signatures = signatures?.length ?? 0
          const simulation = await clients.grpc.core.simulateTransaction({
            transaction,
            include: include ?? {
              effects: true,
              events: true,
              balanceChanges: true
            }
          })
          assertSuccess(simulation, 'astros-bridge.sui-source build-sign simulate')
          return {
            $kind: 'Transaction',
            Transaction: {
              digest: 'dry-run-not-broadcast',
              status: { success: true }
            },
            rawSimulation: simulation
          }
        },
        waitForTransaction: async ({ result }) => result
      }
      const digest = await runSuiSourceSwap(dryProvider)
      return {
        digest,
        bytesLength: captured.bytesLength,
        signatures: captured.signatures
      }
    })
  } else {
    summary.steps.push({
      name: 'astros-bridge.sui-source.build-sign.simulate',
      status: 'skipped',
      reason:
        'Set NAVI_SMOKE_BRIDGE_BUILD_SIGN=1 with a funded wallet to build, sign, and Core-simulate the Mayan v2 Sui-source transaction bytes.'
    })
    log('astros-bridge.sui-source.build-sign.simulate skipped; set NAVI_SMOKE_BRIDGE_BUILD_SIGN=1')
  }

  if (smokeMode === 'execute') {
    if (envBoolean('NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE')) {
      await runStep(summary, 'astros-bridge.sui-source.execute', async () => {
        const digest = await runSuiSourceSwap(clients.grpc)
        return {
          digest,
          amount: envAmount('NAVI_SMOKE_BRIDGE_AMOUNT', '1'),
          targetChain: Number(env('NAVI_SMOKE_BRIDGE_TO_CHAIN') ?? 42161)
        }
      })
    } else {
      summary.steps.push({
        name: 'astros-bridge.sui-source.execute',
        status: 'skipped',
        reason:
          'Set NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE=1 after exact bridge approval to broadcast the Sui-source bridge route.'
      })
      log(
        'astros-bridge.sui-source.execute skipped; set NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE=1 after exact bridge approval'
      )
    }
  }
}

function printPlan(summary, clients, wallet, scopes, smokeMode) {
  const transferAmount = envInt('NAVI_SMOKE_TRANSFER_MIST', 1)
  const lendingAmount = envInt('NAVI_SMOKE_LENDING_DEPOSIT_MIST', 10_000_000)
  const swapAmount = envInt('NAVI_SMOKE_SWAP_MIST', 10_000_000)
  const dcaAmount = envInt('NAVI_SMOKE_DCA_MIST', 10_000_000)
  summary.plan = {
    mode: smokeMode,
    network: clients.network,
    walletAddress: wallet.address,
    transports: {
      grpc: Boolean(clients.grpcEndpoint),
      graphql: Boolean(clients.graphqlUrl),
      explicitLegacyJsonRpc: Boolean(clients.legacyJsonRpcUrl)
    },
    executeEnabled:
      smokeMode === 'execute' && env('NAVI_SMOKE_ENABLE_EXECUTE') === '1'
        ? true
        : smokeMode === 'execute'
          ? false
          : undefined,
    scopes: [...scopes],
    actions: [
      scopes.has('wallet')
        ? {
            package: '@naviprotocol/wallet-client',
            action: 'self-transfer',
            amountMist: transferAmount,
            execute: smokeMode === 'execute'
          }
        : undefined,
      scopes.has('lending')
        ? {
            package: '@naviprotocol/lending',
            action: 'deposit SUI',
            amountMist: lendingAmount,
            execute: smokeMode === 'execute',
            note: 'position-changing; no automatic withdraw cleanup in this smoke'
          }
        : undefined,
      scopes.has('aggregator')
        ? {
            package: '@naviprotocol/astros-aggregator-sdk',
            action: 'swap SUI to target coin',
            amountMist: swapAmount,
            targetCoin: env('NAVI_SMOKE_SWAP_TO_COIN') ?? NAVX,
            execute: smokeMode === 'execute'
          }
        : undefined,
      scopes.has('dca')
        ? {
            package: '@naviprotocol/astros-dca-sdk',
            action: 'create DCA order',
            amountMist: dcaAmount,
            targetCoin: env('NAVI_SMOKE_DCA_TO_COIN') ?? NAVX,
            execute: smokeMode === 'execute',
            note: 'creates an on-chain order; cancel cleanup should be run as a separate exact action if needed'
          }
        : undefined,
      scopes.has('bridge')
        ? {
            package: '@naviprotocol/astros-bridge-sdk',
            action: 'quote Sui-source bridge route',
            amount: envAmount('NAVI_SMOKE_BRIDGE_AMOUNT', '1'),
            targetChain: Number(env('NAVI_SMOKE_BRIDGE_TO_CHAIN') ?? 42161),
            execute: smokeMode === 'execute' && envBoolean('NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE'),
            note:
              smokeMode === 'execute' && envBoolean('NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE')
                ? 'broadcasts the Sui-source bridge route and waits for Sui execution'
                : 'real bridge execute requires NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE=1 after exact approval'
          }
        : undefined
    ].filter(Boolean)
  }
}

async function main() {
  const smokeMode = mode()
  if (!['simulate', 'plan', 'execute'].includes(smokeMode)) {
    throw new Error(`Unsupported mode: ${smokeMode}`)
  }

  const [lending, wallet, aggregator, dca, bridge] = await assertBuiltPackages()
  const packages = { lending, wallet, aggregator, dca, bridge }
  const clients = getClients()
  const testWallet = getWallet()
  const scopes = selectedScopes()
  const summary = {
    mode: smokeMode,
    steps: []
  }

  printPlan(summary, clients, testWallet, scopes, smokeMode)
  log(`wallet address: ${testWallet.address}`)
  log(`mode: ${smokeMode}`)
  log(
    `transports: grpc=${Boolean(clients.grpcEndpoint)} graphql=${Boolean(
      clients.graphqlUrl
    )} legacyJsonRpc=${Boolean(clients.legacyJsonRpcUrl)}`
  )

  if (smokeMode === 'plan') {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  if (smokeMode === 'execute' && env('NAVI_SMOKE_ENABLE_EXECUTE') !== '1') {
    console.log(JSON.stringify(summary, null, 2))
    throw new Error(
      'execute mode requested but NAVI_SMOKE_ENABLE_EXECUTE=1 is not set; review the plan and request exact approval before broadcasting'
    )
  }

  if (scopes.has('transport')) {
    await runTransportSmoke(summary, clients, testWallet.address)
  }
  if (scopes.has('wallet')) {
    await runWalletSmoke(summary, packages, clients, testWallet, smokeMode)
  }
  if (scopes.has('lending')) {
    await runLendingSmoke(summary, packages, clients, testWallet, smokeMode)
  }
  if (scopes.has('aggregator')) {
    await runAggregatorSmoke(summary, packages, clients, testWallet, smokeMode)
  }
  if (scopes.has('dca')) {
    await runDcaSmoke(summary, packages, clients, testWallet, smokeMode)
  }
  if (scopes.has('bridge')) {
    await runBridgeSmoke(summary, packages, clients, testWallet, smokeMode)
  }

  console.log(JSON.stringify(summary, null, 2))
  log('completed')
}

main().catch((error) => {
  console.error(`[sdk-core-live] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
