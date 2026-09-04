import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress, normalizeStructTag, parseToUnits } from '@mysten/sui/utils'
import { expect } from 'vitest'
import { getVaults, navi, parseMoveAbort, volo } from '../../src'
import type { VaultSdkErrorCode } from '../../src'
import type { Vault } from '../../src/types'
import { VaultTestReport } from '../report'

export const runLiveTests = process.env.NAVI_LIVE_TESTS === '1'
export const GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql'
export const GRPC_URL = 'https://fullnode.mainnet.sui.io:443'
export const SUI = normalizeStructTag('0x2::sui::SUI')
export const MIN_GAS_BALANCE = 50_000_000n

export const report = new VaultTestReport({
  enabledBy: process.env.VAULT_TEST_REPORT,
  network: 'mainnet',
  graphqlUrl: GRAPHQL_URL,
  grpcUrl: GRPC_URL
})

export const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: GRPC_URL
})

const graphql = new SuiGraphQLClient({
  network: 'mainnet',
  url: GRAPHQL_URL
})

export type Source = 'navi' | 'volo'

type IndexedEvent = {
  sender?: { address: string } | null
  contents?: {
    json?: Record<string, unknown> | null
    type?: { repr: string } | null
  } | null
}

export type ChainPosition = {
  source: Source
  owner: string
  vault: Vault
  receiptId: string
  shares: bigint
}

export type MainnetContext = {
  vaults: Vault[]
  naviPosition: ChainPosition
  voloPosition: ChainPosition
}

let mainnetContext: MainnetContext | undefined

const EVENT_QUERY = `
  query RecentVaultEvents($type: String!) {
    events(last: 50, filter: { type: $type }) {
      nodes {
        sender { address }
        contents { json type { repr } }
      }
    }
  }
`

function originalPackage(type: string) {
  return type.split('::')[0]
}

function eventType(source: Source) {
  return source === 'navi'
    ? `${originalPackage(navi.receiptType)}::events::DepositEvent`
    : `${originalPackage(volo.receiptType)}::vault::DepositExecuted`
}

export function vaultEventType(source: Source, name: string) {
  const receipt = source === 'navi' ? navi.receiptType : volo.receiptType
  const module = source === 'navi' ? 'events' : 'vault'
  return `${originalPackage(receipt)}::${module}::${name}`
}

async function recentEvents(source: Source): Promise<IndexedEvent[]> {
  const response = await graphql.query<{
    events: { nodes: IndexedEvent[] }
  }>({
    query: EVENT_QUERY,
    variables: { type: eventType(source) }
  })
  if (response.errors?.length) {
    throw new Error(`Sui GraphQL event query failed: ${JSON.stringify(response.errors)}`)
  }
  return response.data?.events.nodes ?? []
}

function eventAddress(event: IndexedEvent, source: Source) {
  const json = event.contents?.json
  const value = source === 'navi' ? json?.sender : json?.recipient
  return typeof value === 'string' ? normalizeSuiAddress(value) : null
}

function eventVaultId(event: IndexedEvent, source: Source) {
  const json = event.contents?.json
  const value = source === 'navi' ? json?.vault : json?.vault_id
  return typeof value === 'string' ? normalizeSuiAddress(value) : null
}

export async function receiptsFor(source: Source, vault: Vault, owner: string) {
  return source === 'navi'
    ? await navi.getVaultReceipts(vault, owner, { client })
    : await volo.getVaultReceipts(vault, owner, { client })
}

async function discoverChainPosition(source: Source, vaults: Vault[]): Promise<ChainPosition> {
  const byId = new Map(
    vaults
      .filter((vault) => vault.source === source)
      .map((vault) => [normalizeSuiAddress(vault.id), vault])
  )
  const seen = new Set<string>()

  for (const event of (await recentEvents(source)).reverse()) {
    const owner = eventAddress(event, source)
    const vaultId = eventVaultId(event, source)
    const vault = vaultId ? byId.get(vaultId) : undefined
    if (!owner || !vault) continue

    const key = `${owner}:${vault.id}`
    if (seen.has(key)) continue
    seen.add(key)

    const receipts = await receiptsFor(source, vault, owner)
    const receipt = receipts.find((candidate) => candidate.shares > 0n)
    if (!receipt) continue
    if (
      source === 'navi' &&
      (!('rewards' in receipt) ||
        !receipt.rewards.some((reward) => reward.claimable + reward.pending > 0n))
    ) {
      continue
    }

    const { balance } = await client.getBalance({ owner, coinType: SUI })
    if (BigInt(balance.balance) < MIN_GAS_BALANCE) continue

    return {
      source,
      owner,
      vault,
      receiptId: receipt.id,
      shares: receipt.shares
    }
  }

  throw new Error(`No funded ${source} vault holder was discoverable from recent chain events`)
}

/** Raw base units -> exact human decimal string (the unit the public API takes). */
export function rawToHuman(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const int = raw / base
  const frac = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int.toString()
}

/**
 * What a live deposit case deposits: one whole token, or the vault's advertised
 * `minInvestment` where that is larger. `depositPTB` rejects a deposit under the minimum
 * before it builds anything, so a smaller amount would never reach the chain — even though
 * the contract itself does not enforce the figure.
 */
export function depositAmountFor(vault: Vault): bigint {
  const decimals = vault.assets.baseCoin.decimals
  const oneToken = 10n ** BigInt(decimals)
  const minimum =
    typeof vault.minInvestment === 'number' && vault.minInvestment > 0
      ? parseToUnits(vault.minInvestment.toFixed(decimals), decimals)
      : 0n
  return minimum > oneToken ? minimum : oneToken
}

export async function discoverDepositor(source: Source) {
  const { vaults } = getMainnetContext()
  const byId = new Map(
    vaults
      .filter((vault) => vault.source === source && vault.status === 'open')
      .map((vault) => [normalizeSuiAddress(vault.id), vault])
  )
  const seen = new Set<string>()

  for (const event of (await recentEvents(source)).reverse()) {
    const owner = eventAddress(event, source)
    const vaultId = eventVaultId(event, source)
    const vault = vaultId ? byId.get(vaultId) : undefined
    if (!owner || !vault) continue

    const key = `${owner}:${vault.id}`
    if (seen.has(key)) continue
    seen.add(key)

    const amount = depositAmountFor(vault)
    const [{ balance: gas }, { balance: base }] = await Promise.all([
      client.getBalance({ owner, coinType: SUI }),
      client.getBalance({ owner, coinType: vault.assets.baseCoin.coinType })
    ])
    const requiredGas =
      normalizeStructTag(vault.assets.baseCoin.coinType) === SUI
        ? amount + MIN_GAS_BALANCE
        : MIN_GAS_BALANCE
    if (BigInt(gas.balance) < requiredGas || BigInt(base.balance) < amount) continue

    return { owner, vault }
  }

  throw new Error(`No ${source} depositor with enough current balance was found on chain`)
}

export async function dryRun(tx: Transaction, sender: string) {
  tx.setSenderIfNotSet(sender)
  const result = await client.simulateTransaction({
    transaction: tx,
    include: { effects: true, events: true, balanceChanges: true }
  })
  if (result.$kind === 'FailedTransaction') {
    const error = result.FailedTransaction.status.error as {
      command?: number
      CommandArgumentError?: { argument?: number }
    }
    const failedCommand = tx.getData().commands[error.command ?? -1] as
      | { MoveCall?: { arguments?: unknown[] } }
      | undefined
    const failedArgument = failedCommand?.MoveCall?.arguments?.[
      error.CommandArgumentError?.argument ?? -1
    ] as { Input?: number } | undefined
    const failedInput =
      failedArgument?.Input === undefined ? undefined : tx.getData().inputs[failedArgument.Input]
    const commands = tx.getData().commands.map((command, index) => {
      const moveCall = (
        command as {
          MoveCall?: { package: string; module: string; function: string }
        }
      ).MoveCall
      return moveCall
        ? `${index}:${moveCall.package}::${moveCall.module}::${moveCall.function}`
        : `${index}:${Object.keys(command)[0]}`
    })
    throw new Error(
      `PTB dry-run failed: ${JSON.stringify(result.FailedTransaction.status.error)}; ` +
        `failedInput=${JSON.stringify(failedInput)}; commands=${commands.join(',')}`
    )
  }
  expect(result.Transaction.effects?.status.success).toBe(true)
  return result.Transaction
}

/**
 * The chain-side conditions no PTB can be built around: the vault is locked or
 * mid-operation (5022), or the configured package address is behind the deployed one
 * (5013). A live case that hits one of these is reported as skipped, not failed — the
 * request was built correctly and the chain declined it.
 */
const UNAVOIDABLE_ABORT_CODES: VaultSdkErrorCode[] = [
  'VAULT_NOT_OPEN',
  'UNSUPPORTED_CONFIG_VERSION'
]

/**
 * The decoded abort when a dry-run failed for a reason the SDK cannot build around, else
 * `undefined`. Uses the SDK's own decoder, so the test suite and its callers classify a
 * given abort the same way.
 */
export function unavoidableAbort(error: unknown) {
  const abort = parseMoveAbort(error)
  return abort && UNAVOIDABLE_ABORT_CODES.includes(abort.code) ? abort : undefined
}

export function requireEvent(
  result: Awaited<ReturnType<typeof dryRun>>,
  expectedType: string,
  fields: Record<string, string>
) {
  const event = result.events?.find(
    (candidate) =>
      candidate.eventType === expectedType &&
      Object.entries(fields).every(([key, value]) => String(candidate.json?.[key]) === value)
  )
  const sameType = result.events
    ?.filter((candidate) => candidate.eventType === expectedType)
    .map((candidate) => candidate.json)
  expect(
    event,
    `missing ${expectedType} with ${JSON.stringify(fields)}; actual=${JSON.stringify(sameType)}`
  ).toBeDefined()
  return event!
}

export function requireBalanceChange(
  result: Awaited<ReturnType<typeof dryRun>>,
  owner: string,
  coinType: string
) {
  const change = result.balanceChanges?.find(
    (candidate) =>
      normalizeSuiAddress(candidate.address) === normalizeSuiAddress(owner) &&
      normalizeStructTag(candidate.coinType) === normalizeStructTag(coinType)
  )
  expect(change, `missing ${coinType} balance change for ${owner}`).toBeDefined()
  return change!
}

export function positionData(position: ChainPosition) {
  return {
    source: position.source,
    owner: position.owner,
    vault: position.vault,
    receiptId: position.receiptId,
    shares: position.shares
  }
}

export function dryRunData(result: Awaited<ReturnType<typeof dryRun>>) {
  return {
    effectsStatus: result.effects?.status,
    events:
      result.events?.map((event) => ({
        packageId: event.packageId,
        module: event.module,
        sender: event.sender,
        eventType: event.eventType,
        json: event.json,
        bcsBase64: Buffer.from(event.bcs).toString('base64')
      })) ?? [],
    balanceChanges: result.balanceChanges ?? []
  }
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return error
}

export async function initializeMainnetContext() {
  if (!runLiveTests) {
    report.add({
      api: 'suite',
      title: 'Mainnet integration suite',
      status: 'skipped',
      purpose: 'Run live-chain read and PTB dry-run coverage.',
      reason: 'NAVI_LIVE_TESTS was not set to 1.'
    })
    return
  }

  const vaults = await getVaults({ disableCache: true })
  const [naviPosition, voloPosition] = await Promise.all([
    discoverChainPosition('navi', vaults),
    discoverChainPosition('volo', vaults)
  ])
  mainnetContext = { vaults, naviPosition, voloPosition }
  report.addContext('Chain-derived wallets and positions', {
    navi: positionData(naviPosition),
    volo: positionData(voloPosition)
  })
}

export function getMainnetContext() {
  if (!mainnetContext) {
    throw new Error('Mainnet test context has not been initialized')
  }
  return mainnetContext
}
