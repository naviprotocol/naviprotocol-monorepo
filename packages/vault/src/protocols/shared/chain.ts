import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { VaultSdkError } from '../../errors'
import type { VaultSuiClient } from '../../types'
import { ReceiptStruct } from './bcs'

/**
 * Locates a protocol's receipt type.
 *
 * The type filter must use the ORIGINAL package id: the current call target matches
 * nothing and reports no error. The module differs per protocol —
 * `navi_vault::Receipt` versus `volo_vault::receipt::Receipt`.
 */
export type ReceiptTypeRef = {
  initialPackageId: string
  module: string
  vaultId: string
}

type OwnedObjectsPage = {
  objects: { objectId: string; content?: Uint8Array | null }[]
  cursor?: string | null
  hasNextPage?: boolean
}

type CoinsPage = {
  objects: { objectId: string; balance: string }[]
  cursor?: string | null
  hasNextPage?: boolean
}

type CoreApi = {
  listOwnedObjects?(input: unknown): Promise<OwnedObjectsPage>
  listCoins?(input: unknown): Promise<CoinsPage>
}

function core(client: VaultSuiClient, capability: string): CoreApi {
  const api = client.core as CoreApi | undefined
  if (!api) {
    throw new VaultSdkError('CHAIN_QUERY_FAILED', `${capability} requires a Sui v2 Core client.`)
  }
  return api
}

const SUI_COIN_TYPE = '0x2::sui::SUI'

function normalizeType(coinType: string): string {
  const [address, ...rest] = coinType.split('::')
  return [normalizeAddress(address ?? ''), ...rest].join('::')
}

function normalizeAddress(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  return `0x${hex.toLowerCase().padStart(64, '0')}`
}

/**
 * Advances a paginated cursor, refusing to reuse one.
 *
 * A transport that reports another page but returns no cursor — or echoes the cursor it
 * was given — would otherwise re-fetch the same page forever, hanging the caller with no
 * error at all.
 */
function nextCursor(
  page: { cursor?: string | null; hasNextPage?: boolean },
  sent: string | null | undefined
) {
  const candidate = page.hasNextPage ? (page.cursor ?? null) : null
  return candidate && candidate !== sent ? candidate : null
}

/**
 * Lists the owner's receipts for one vault.
 *
 * A receipt type is not generic, so one type covers every vault on the deployment and
 * each object's vault field has to be compared individually. That is load-bearing rather
 * than defensive: several vaults share a coin type.
 */
export async function listReceipts(
  client: VaultSuiClient,
  receipt: ReceiptTypeRef,
  owner: string
): Promise<string[]> {
  const api = core(client, 'Receipt discovery')
  if (typeof api.listOwnedObjects !== 'function') {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      'Receipt discovery requires core.listOwnedObjects.'
    )
  }

  const receiptType = `${receipt.initialPackageId}::${receipt.module}::Receipt`
  const vaultAddress = normalizeAddress(receipt.vaultId)
  const found: string[] = []
  let cursor: string | null | undefined

  do {
    const page = await api.listOwnedObjects({
      owner,
      type: receiptType,
      cursor,
      include: { content: true }
    })

    for (const object of page.objects) {
      if (!object.content) continue
      const parsed = ReceiptStruct.parse(Uint8Array.from(object.content))
      if (normalizeAddress(parsed.vaultId) !== vaultAddress) continue
      found.push(normalizeAddress(object.objectId))
    }

    cursor = nextCursor(page, cursor)
  } while (cursor)

  return found
}

/**
 * Produces a coin argument holding exactly `amount`.
 *
 * The contract asserts `deposit_coin.value() == amount` and aborts `E_AMOUNT_MISMATCH`
 * otherwise, so an approximate coin is never acceptable. SUI splits from the gas coin;
 * every other asset is gathered, merged and split, because an owner's balance is normally
 * spread across several objects.
 */
export async function prepareExactCoin(
  tx: Transaction,
  client: VaultSuiClient,
  args: { owner: string; coinType: string; amount: bigint; useGasCoin?: boolean }
): Promise<TransactionObjectArgument> {
  // Compare the whole type, not just the package: `0x2` also publishes coins that are
  // not the gas coin, and splitting one of those from gas would fund the deposit with
  // the wrong asset.
  const isSui = normalizeType(args.coinType) === normalizeType(SUI_COIN_TYPE)
  if (isSui) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.amount)])
    return coin as TransactionObjectArgument
  }

  if (args.useGasCoin) {
    throw new VaultSdkError(
      'UNSUPPORTED_DEPOSIT_ASSET',
      `useGasCoin only applies to ${SUI_COIN_TYPE}; splitting gas would fund a ` +
        `${args.coinType} deposit with SUI.`
    )
  }

  const api = core(client, 'Coin selection')
  if (typeof api.listCoins !== 'function') {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      `Depositing ${args.coinType} requires core.listCoins, or an explicit coin argument.`
    )
  }

  const owned: string[] = []
  let total = 0n
  let cursor: string | null | undefined

  do {
    const page = await api.listCoins({ owner: args.owner, coinType: args.coinType, cursor })
    for (const coin of page.objects) {
      const balance = BigInt(coin.balance)
      if (balance === 0n) continue
      owned.push(coin.objectId)
      total += balance
    }
    cursor = nextCursor(page, cursor)
  } while (cursor)

  const [primary, ...rest] = owned
  if (!primary || total < args.amount) {
    throw new VaultSdkError(
      'INSUFFICIENT_BALANCE',
      `Owner holds ${total} of ${args.coinType}, needs ${args.amount}.`
    )
  }

  const primaryArg = tx.object(primary)
  if (rest.length > 0) {
    tx.mergeCoins(
      primaryArg,
      rest.map((objectId) => tx.object(objectId))
    )
  }

  const [coin] = tx.splitCoins(primaryArg, [tx.pure.u64(args.amount)])
  return coin as TransactionObjectArgument
}
