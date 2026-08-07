/**
 * Compile-only assertions against the BUILT `dist/index.d.ts`, not the source.
 *
 * Run by `pnpm test:types`. Nothing here executes; the file exists so that a change to
 * the public type surface fails the build rather than a consumer's.
 */
import type { Transaction } from '@mysten/sui/transactions'
import {
  buildDepositTx,
  buildExitAllTx,
  buildWithdrawTx,
  buildWithdrawTxWithPreview,
  decode,
  findReceipts,
  getVaultLayout,
  getVaultQuote,
  MAINNET_VAULT_CONFIG,
  MarketStatus,
  parseVaultError,
  previewWithdraw,
  sharePrice,
  MAX_U64,
  WAD
} from '@naviprotocol/vault'
import type {
  MarketLayout,
  VaultConfig,
  VaultError,
  VaultLayout,
  VaultPosition,
  VaultQuote,
  VaultReceipt,
  WithdrawPreview
} from '@naviprotocol/vault'

declare const client: never
declare const sender: string
declare const receiptId: string

/** Raw on-chain integers are bigint, never number or string. */
export async function amountsAreBigint(): Promise<void> {
  const layout: VaultLayout = await getVaultLayout('USDC', { client })
  const cap: bigint = layout.vaultCap
  const shares: bigint = layout.totalShares
  const fee: bigint = layout.managementFee

  const market: MarketLayout | undefined = layout.markets[0]
  const balance: bigint | undefined = market?.currentBalance
  const lastSync: bigint | undefined = market?.lastSyncAtMs
  const assetId: number | undefined = market?.assetId

  void [cap, shares, fee, balance, lastSync, assetId]
}

/** Quotes expose bigint amounts and a nullable headroom. */
export async function quoteShape(): Promise<void> {
  const quote: VaultQuote = await getVaultQuote('SUI', { client })
  const total: bigint = quote.totalAssets
  const headroom: bigint | null = quote.depositHeadroom
  const price: number = sharePrice(quote)
  void [total, headroom, price]
}

/** Builders return a Sui v2 Transaction. */
export async function buildersReturnTransactions(): Promise<void> {
  const deposit: Transaction = await buildDepositTx(
    { vault: 'USDC', amount: 1_000_000n, sender },
    { client }
  )
  // position accepts a receipt id or the 'new' sentinel, and nothing else.
  const explicit: Transaction = await buildDepositTx(
    { vault: 'USDC', amount: 1_000_000n, sender, position: receiptId },
    { client }
  )
  const fresh: Transaction = await buildDepositTx(
    { vault: 'USDC', amount: 1_000_000n, sender, position: 'new' },
    { client }
  )
  void [explicit, fresh]
  const withdraw: Transaction = await buildWithdrawTx(
    { vault: 'USDC', receiptId, amount: 1_000_000n, sender, maxShares: 1_100_000n },
    { client }
  )
  const previewed = await buildWithdrawTxWithPreview(
    { vault: 'USDC', receiptId, amount: 1_000_000n, sender },
    { client }
  )
  const exit = await buildExitAllTx({ vault: 'USDC', receiptId, sender }, { client })

  const tx1: Transaction = previewed.transaction
  const tx2: Transaction = exit.transaction
  const bound: bigint = previewed.maxShares
  void [deposit, withdraw, tx1, tx2, bound]
}

/** previewWithdraw reports the contract's own figure plus a derived bound. */
export async function previewShape(): Promise<void> {
  const preview: WithdrawPreview = await previewWithdraw(
    { vault: 'SUI', receiptId, amount: MAX_U64, sender },
    { client }
  )
  const burned: bigint = preview.sharesBurned
  const out: bigint | undefined = preview.amountOut
  void [burned, out]
}

/** Receipts carry the attribution field, since the type alone cannot identify a vault. */
export async function receiptShape(): Promise<void> {
  const receipts: VaultReceipt[] = await findReceipts(sender, 'SUI', { client })
  const vaultAddress: string | undefined = receipts[0]?.vaultAddress
  void vaultAddress
}

/** Decoded aborts carry a classification a caller can branch on. */
export function errorShape(): void {
  const decoded: VaultError | undefined = parseVaultError('abort')
  if (decoded?.kind === 'outage') {
    const code: number = decoded.code
    void code
  }
}

/** Constants keep their bigint type through the barrel. */
export function constantsAreBigint(): void {
  const wad: bigint = WAD
  const max: bigint = MAX_U64
  const config: VaultConfig = MAINNET_VAULT_CONFIG
  const active: MarketStatus = MarketStatus.Active
  const u64: (bytes: Uint8Array) => bigint = decode.u64
  void [wad, max, config, active, u64]
}

/** Positions are per receipt, never merged. */
export function positionShape(positions: VaultPosition[]): void {
  const id: string | undefined = positions[0]?.receiptId
  const shares: bigint | undefined = positions[0]?.shares
  void [id, shares]
}
