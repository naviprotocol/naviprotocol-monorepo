#!/usr/bin/env node

const suiPackageRoot = new URL('../packages/lending/node_modules/@mysten/sui/', import.meta.url)
const [{ GrpcWebFetchTransport, SuiGrpcClient }, { SuiJsonRpcClient }, { Ed25519Keypair }] =
  await Promise.all([
    import(new URL('./dist/grpc/index.mjs', suiPackageRoot)),
    import(new URL('./dist/jsonRpc/index.mjs', suiPackageRoot)),
    import(new URL('./dist/keypairs/ed25519/index.mjs', suiPackageRoot))
  ])

const SUI = '0x2::sui::SUI'
const SUI_CHAIN_ID = 1999

const ROUTES = {
  'arbitrum-usdc': {
    label: 'Sui SUI -> Arbitrum USDC',
    provider: 'Mayan',
    toChain: 42161,
    toSymbol: 'USDC',
    amountEnv: 'NAVI_SMOKE_BRIDGE_ARBITRUM_AMOUNT',
    defaultAmount: '1',
    addressEnv: 'FE_E2E_BNB_ADDRESS',
    overrideAddressEnv: 'NAVI_SMOKE_BRIDGE_ARBITRUM_ADDRESS',
    buildClientMode: 'grpc'
  },
  'solana-usdc': {
    label: 'Sui SUI -> Solana USDC',
    provider: 'Mayan',
    toChain: 0,
    toSymbol: 'USDC',
    amountEnv: 'NAVI_SMOKE_BRIDGE_SOLANA_AMOUNT',
    defaultAmount: '2',
    addressEnv: 'FE_E2E_SOL_ADDRESS',
    overrideAddressEnv: 'NAVI_SMOKE_BRIDGE_SOLANA_ADDRESS',
    buildClientMode: 'legacyJsonRpc'
  }
}

function env(name) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

function requireEnv(name) {
  const value = env(name)
  if (!value) {
    throw new Error(`Missing required env key: ${name}`)
  }
  return value
}

function normalizeGrpcBaseUrl(endpoint) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)
    ? endpoint
    : `https://${endpoint.replace(/\/+$/, '')}`
}

function log(message) {
  console.log(`[sdk-bridge-routes] ${message}`)
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

function selectedRouteKeys() {
  const selected = env('NAVI_SMOKE_BRIDGE_ROUTES')
  if (!selected) return Object.keys(ROUTES)
  return selected
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean)
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
  const grpc = new SuiGrpcClient({
    network,
    transport: new GrpcWebFetchTransport({
      baseUrl: normalizeGrpcBaseUrl(requireEnv('SUI_GRPC_ENDPOINT')),
      meta: tokenHeaders('SUI_GRPC_TOKEN', 'SUI_GRPC_HEADER_NAME', 'authorization')
    })
  })
  const legacyJsonRpcUrl = env('SUI_JSON_RPC_URL')
  const legacyJsonRpc = legacyJsonRpcUrl
    ? new SuiJsonRpcClient({
        network,
        url: legacyJsonRpcUrl
      })
    : undefined
  return { network, grpc, legacyJsonRpc }
}

async function importBridgePackage() {
  return import(new URL('../packages/astros-bridge-sdk/dist/index.esm.js', import.meta.url))
}

function findSuiToken(tokens) {
  return (
    tokens.find((token) => token.address === SUI) ??
    tokens.find((token) => token.symbol?.toUpperCase() === 'SUI')
  )
}

function findUsdcToken(tokens) {
  return tokens.find((token) => token.symbol?.toUpperCase() === 'USDC')
}

function assertSuccess(result, label) {
  const tx = result?.Transaction ?? result
  const failed = result?.FailedTransaction
  const status = failed?.status ?? tx?.status ?? tx?.effects?.status
  if (failed || status?.success === false || status?.status === 'failure') {
    throw new Error(`${label} failed: ${String(status?.error ?? 'unknown status')}`)
  }
}

function normalizeTokenAddress(address) {
  return typeof address === 'string' ? address.toLowerCase() : address
}

function assertRouteMatches({ route, routeConfig, fromToken, toToken }) {
  const fromChain = Number(route.from_token?.chainId)
  const toChain = Number(route.to_token?.chainId)
  const routeToSymbol = route.to_token?.symbol?.toUpperCase()
  const expectedToSymbol = routeConfig.toSymbol.toUpperCase()
  const routeFromAddress = normalizeTokenAddress(route.from_token?.address)
  const expectedFromAddress = normalizeTokenAddress(fromToken.address)
  const routeToAddress = normalizeTokenAddress(route.to_token?.address)
  const expectedToAddress = normalizeTokenAddress(toToken.address)
  const routeProvider = String(route.provider ?? '').toLowerCase()
  const expectedProvider = routeConfig.provider.toLowerCase()

  if (routeProvider !== expectedProvider) {
    throw new Error(`${routeConfig.label}: route provider mismatch, got ${route.provider}`)
  }
  if (fromChain !== SUI_CHAIN_ID || toChain !== routeConfig.toChain) {
    throw new Error(`${routeConfig.label}: route chain mismatch, got ${fromChain}->${toChain}`)
  }
  if (routeFromAddress !== expectedFromAddress) {
    throw new Error(`${routeConfig.label}: route source token mismatch`)
  }
  if (routeToAddress !== expectedToAddress || routeToSymbol !== expectedToSymbol) {
    throw new Error(
      `${routeConfig.label}: route target token mismatch, got ${route.to_token?.chainId}:${route.to_token?.symbol}`
    )
  }
}

async function buildQuote(bridge, routeConfig) {
  const [fromTokens, toTokens] = await Promise.all([
    bridge.getSupportTokens(SUI_CHAIN_ID, 1, 20),
    bridge.getSupportTokens(routeConfig.toChain, 1, 20)
  ])
  const fromToken = findSuiToken(fromTokens)
  const toToken = findUsdcToken(toTokens)
  if (!fromToken) {
    throw new Error(`${routeConfig.label}: no SUI source token available`)
  }
  if (!toToken) {
    throw new Error(`${routeConfig.label}: no ${routeConfig.toSymbol} target token available`)
  }
  const amount = env(routeConfig.amountEnv) ?? routeConfig.defaultAmount
  const quote = await bridge.getQuote(fromToken, toToken, amount, {
    slippageBps: Number(env('NAVI_SMOKE_BRIDGE_SLIPPAGE_BPS') ?? 50)
  })
  const route = quote.routes?.[0]
  if (!route) {
    throw new Error(`${routeConfig.label}: no route available`)
  }
  assertRouteMatches({ route, routeConfig, fromToken, toToken })
  return { amount, fromToken, toToken, quote, route }
}

function resolveDestination(routeConfig) {
  return env(routeConfig.overrideAddressEnv) ?? env(routeConfig.addressEnv)
}

async function simulateRoute({ bridge, clients, wallet, key, routeConfig }) {
  const destination = resolveDestination(routeConfig)
  if (!destination) {
    throw new Error(
      `${routeConfig.label}: missing env key ${routeConfig.overrideAddressEnv} or ${routeConfig.addressEnv}`
    )
  }
  if (routeConfig.buildClientMode === 'legacyJsonRpc' && !clients.legacyJsonRpc) {
    throw new Error(
      `${routeConfig.label}: SUI_JSON_RPC_URL is required for legacyJsonRpc buildClient`
    )
  }

  const { amount, quote, route, toToken } = await buildQuote(bridge, routeConfig)
  const buildClient =
    routeConfig.buildClientMode === 'legacyJsonRpc' ? clients.legacyJsonRpc : undefined
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
      assertSuccess(simulation, `${routeConfig.label} Core simulate`)
      return {
        $kind: 'Transaction',
        Transaction: {
          digest: 'route-matrix-dry-run-not-broadcast',
          status: { success: true }
        },
        rawSimulation: simulation
      }
    },
    waitForTransaction: async ({ result }) => result
  }

  const result = await bridge.swap(route, wallet.address, destination, {
    sui: {
      provider: dryProvider,
      ...(buildClient ? { buildClient } : {}),
      signTransaction: async ({ transaction }) => {
        const txBytes = await transaction.build({ client: buildClient ?? clients.grpc })
        return wallet.keypair.signTransaction(txBytes)
      }
    }
  })
  if (captured.bytesLength <= 0) {
    throw new Error(`${routeConfig.label}: signed transaction bytes were not captured`)
  }
  if (captured.signatures !== 1) {
    throw new Error(`${routeConfig.label}: expected one signature, captured ${captured.signatures}`)
  }

  return {
    key,
    label: routeConfig.label,
    status: 'passed',
    amount,
    routes: quote.routes?.length ?? 0,
    provider: route.provider,
    target: `${toToken.chainId}:${toToken.symbol}`,
    buildClient: routeConfig.buildClientMode,
    digest: result.id,
    bytesLength: captured.bytesLength,
    signatures: captured.signatures
  }
}

async function main() {
  const bridge = await importBridgePackage()
  if (typeof bridge.config === 'function') {
    bridge.config({
      ...(env('NAVI_BRIDGE_BASE_URL') ? { baseUrl: env('NAVI_BRIDGE_BASE_URL') } : {}),
      ...(env('NAVI_BRIDGE_API_KEY') ? { apiKey: env('NAVI_BRIDGE_API_KEY') } : {})
    })
    if (env('NAVI_BRIDGE_API_KEY')) {
      log('NAVI_BRIDGE_API_KEY present; bridge API key value redacted')
    }
  }
  const clients = getClients()
  const wallet = getWallet()
  const summary = {
    network: clients.network,
    walletAddress: wallet.address,
    routes: []
  }
  const routeKeys = selectedRouteKeys()
  log(`wallet address: ${wallet.address}`)
  log(
    `transports: grpc=true legacyJsonRpc=${Boolean(clients.legacyJsonRpc)} selected=${routeKeys.join(',')}`
  )

  for (const key of routeKeys) {
    const routeConfig = ROUTES[key]
    if (!routeConfig) {
      throw new Error(`Unknown route key: ${key}`)
    }
    log(`${routeConfig.label}: build/sign/Core-simulate start`)
    const result = await simulateRoute({ bridge, clients, wallet, key, routeConfig })
    summary.routes.push(result)
    log(`${routeConfig.label}: ${result.status}`)
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(
    `[sdk-bridge-routes] failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
