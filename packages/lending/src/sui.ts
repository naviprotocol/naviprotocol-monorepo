import type { CoinStruct } from '@mysten/sui/jsonRpc'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import type { NaviSdkServiceOptions } from './services'

const DEFAULT_SUI_COIN_TYPE = '0x2::sui::SUI'
export type NaviSuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet' | (string & {})

export type NaviSuiGrpcEndpoint = {
  url: string
}

export type NaviSuiGraphQLEndpoint = {
  url: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export type NaviSuiGrpcOptions =
  | {
      client: NaviCoreClient
      url?: never
      headers?: never
      fetch?: never
    }
  | NaviSuiGrpcEndpoint

export type NaviSuiGraphQLOptions =
  | {
      client: NaviCoreClient & { query?(options: any): Promise<any> }
      url?: never
      headers?: never
      fetch?: never
    }
  | NaviSuiGraphQLEndpoint

export type NaviSuiLegacyJsonRpcOptions =
  | {
      client: NaviJsonRpcCompatClient
      url?: never
    }
  | {
      url: string
    }

export type NaviSuiClientOptions = {
  network: NaviSuiNetwork
  grpc: NaviSuiGrpcOptions
  graphql?: NaviSuiGraphQLOptions
  /**
   * @deprecated JSON-RPC is a short-lived compatibility transport. New main paths must use gRPC/Core.
   */
  legacyJsonRpc?: NaviSuiLegacyJsonRpcOptions
  services?: NaviSdkServiceOptions
}

export type NaviSuiClientBundle = {
  network: NaviSuiNetwork
  coreClient: NaviCoreClient
  grpc: NaviCoreClient
  graphql?: NaviCoreClient & { query?(options: any): Promise<any> }
  /**
   * @deprecated JSON-RPC is a short-lived compatibility transport.
   */
  legacyJsonRpc?: NaviJsonRpcCompatClient
  services?: NaviSdkServiceOptions
}

type SuiAddressBalanceLike = {
  coinType?: string | null
  balance?: string | number | bigint | null
  totalBalance?: string | number | bigint | null
  coinBalance?: string | number | bigint | null
  addressBalance?: string | number | bigint | null
  fundsInAddressBalance?: string | number | bigint | null
  coinObjectCount?: number | null
}

type NaviBalanceCore = {
  getBalance(options: any): Promise<{ balance?: SuiAddressBalanceLike } | SuiAddressBalanceLike>
  listBalances(options: any): Promise<{
    balances?: SuiAddressBalanceLike[]
    nextCursor?: string | null
  }>
}

export type NaviCoreClient = {
  core: unknown
}

export type NaviJsonRpcCompatClient = NaviCoreClient & {
  devInspectTransactionBlock(options: any): Promise<any>
  dryRunTransactionBlock(options: any): Promise<any>
  executeTransactionBlock(options: any): Promise<any>
  getAllCoins(options: any): Promise<any>
  getCoinMetadata(options: any): Promise<any>
  getCoins(options: any): Promise<any>
  getDynamicFieldObject(options: any): Promise<any>
  getObject(options: any): Promise<any>
  getTransactionBlock(options: any): Promise<any>
  multiGetObjects(options: any): Promise<any>
  signAndExecuteTransaction(options: any): Promise<any>
  waitForTransaction(options: any): Promise<any>
}

export type NaviSuiClient = NaviJsonRpcCompatClient

export type NaviAddressBalance = {
  coinType: string
  totalBalance: string
  coinBalance: string
  addressBalance: string
  coinObjectCount?: number
}

export class NaviMissingGraphQLClientError extends Error {
  constructor(capability: string) {
    super(
      `NAVI Sui SDK capability "${capability}" requires an explicit graphql client; no public GraphQL fallback is configured`
    )
    this.name = 'NaviMissingGraphQLClientError'
  }
}

function balanceValueToString(value: string | number | bigint | null | undefined) {
  return value === null || value === undefined ? undefined : String(value)
}

function addBalanceStrings(left: string, right: string) {
  return (BigInt(left) + BigInt(right)).toString()
}

function subtractBalanceStrings(left: string, right: string) {
  return (BigInt(left) - BigInt(right)).toString()
}

function getCoreBalanceClient(client: NaviCoreClient): NaviBalanceCore {
  const core = client.core as Partial<NaviBalanceCore> | undefined
  if (typeof core?.getBalance !== 'function' || typeof core?.listBalances !== 'function') {
    throw new Error('NAVI Sui balance helpers require a v2 Core API client')
  }
  return core as NaviBalanceCore
}

export function normalizeAddressBalance(
  balance: SuiAddressBalanceLike,
  fallbackCoinType = DEFAULT_SUI_COIN_TYPE
): NaviAddressBalance {
  const addressBalance =
    balanceValueToString(balance.addressBalance ?? balance.fundsInAddressBalance) ?? '0'
  let totalBalance = balanceValueToString(balance.balance ?? balance.totalBalance)
  let coinBalance = balanceValueToString(balance.coinBalance)

  if (!coinBalance && totalBalance) {
    coinBalance = subtractBalanceStrings(totalBalance, addressBalance)
  }
  if (!totalBalance && coinBalance) {
    totalBalance = addBalanceStrings(coinBalance, addressBalance)
  }

  return {
    coinType: normalizeStructTag(balance.coinType ?? fallbackCoinType),
    totalBalance: totalBalance ?? '0',
    coinBalance: coinBalance ?? '0',
    addressBalance,
    ...(balance.coinObjectCount === null || balance.coinObjectCount === undefined
      ? {}
      : { coinObjectCount: balance.coinObjectCount })
  }
}

export function getCoinObjectOnlyBalance(coins: CoinStruct[], coinType = DEFAULT_SUI_COIN_TYPE) {
  const normalizedCoinType = normalizeStructTag(coinType)
  return coins
    .filter((coin) => normalizeStructTag(coin.coinType) === normalizedCoinType)
    .reduce((sum, coin) => sum + BigInt(coin.balance), 0n)
    .toString()
}

export async function getAddressBalance(
  client: NaviCoreClient,
  options: { owner: string; coinType?: string }
) {
  const response = await getCoreBalanceClient(client).getBalance(options)
  const responseBalance = (response as { balance?: SuiAddressBalanceLike }).balance
  const balance =
    responseBalance && typeof responseBalance === 'object'
      ? responseBalance
      : (response as SuiAddressBalanceLike)
  return normalizeAddressBalance(balance ?? {}, options.coinType)
}

export async function listAddressBalances(client: NaviCoreClient, options: { owner: string }) {
  const { balances = [], nextCursor = null } =
    await getCoreBalanceClient(client).listBalances(options)
  return {
    balances: balances.map((balance) => normalizeAddressBalance(balance)),
    nextCursor
  }
}

function createGrpcClient(network: NaviSuiNetwork, grpc: NaviSuiGrpcOptions): NaviCoreClient {
  if ('client' in grpc) {
    return grpc.client
  }
  return new SuiGrpcClient({
    network,
    baseUrl: grpc.url
  })
}

function createGraphQLClient(
  network: NaviSuiNetwork,
  graphql: NaviSuiGraphQLOptions
): NaviCoreClient & { query?(options: any): Promise<any> } {
  if ('client' in graphql) {
    return graphql.client
  }
  return new SuiGraphQLClient({
    network,
    url: graphql.url,
    headers: graphql.headers,
    fetch: graphql.fetch
  })
}

function createLegacyJsonRpcClient(
  network: NaviSuiNetwork,
  legacyJsonRpc: NaviSuiLegacyJsonRpcOptions
): NaviJsonRpcCompatClient {
  if ('client' in legacyJsonRpc) {
    return legacyJsonRpc.client
  }
  return new SuiJsonRpcClient({
    network,
    url: legacyJsonRpc.url
  })
}

export function createNaviSuiClientBundle(options: NaviSuiClientOptions): NaviSuiClientBundle {
  const grpc = createGrpcClient(options.network, options.grpc)
  return {
    network: options.network,
    coreClient: grpc,
    grpc,
    graphql: options.graphql ? createGraphQLClient(options.network, options.graphql) : undefined,
    legacyJsonRpc: options.legacyJsonRpc
      ? createLegacyJsonRpcClient(options.network, options.legacyJsonRpc)
      : undefined,
    services: options.services
  }
}

export function requireNaviGraphQLClient(
  bundle: Pick<NaviSuiClientBundle, 'graphql'>,
  capability: string
) {
  if (!bundle.graphql) {
    throw new NaviMissingGraphQLClientError(capability)
  }
  return bundle.graphql
}

export function createNaviSuiClient(
  url = getJsonRpcFullnodeUrl('mainnet'),
  network: NaviSuiNetwork = 'mainnet'
): NaviSuiClient {
  return new SuiJsonRpcClient({
    network,
    url
  })
}
