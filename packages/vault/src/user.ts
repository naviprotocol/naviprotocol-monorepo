import {
  CacheOption,
  EnvOption,
  VaultPosition,
  VaultProtocol,
  VaultIdentifier,
  PendingRequest
} from './types'
import { fetchVaultApiData, withCache, withSingleton, queryString, parseHumanAmount } from './utils'
import { OPEN_API_URL } from './config'
import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { getVault } from './vault'
import * as navi from './protocols/navi'
import * as volo from './protocols/volo'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { DEFAULT_CACHE_TIME } from '@naviprotocol/lending'
import { isVaultSdkError, vaultErrors } from './error'

export type GetPositionsOptions = Partial<
  {
    /** Restrict the result to these strategy providers. */
    protocols: VaultProtocol[]
    /** Restrict the result to these vault ids. */
    vaults: string[]
  } & EnvOption &
    CacheOption
>

export type GetVaultPositionOptions = Partial<EnvOption & CacheOption>

export type DepositPTBOptions = {
  /** Coin object to deposit from. When omitted, one is split from the owner's balance (or gas coin) for `amount`. */
  coin?: TransactionObjectArgument
  /** Split the deposit coin from the transaction's gas coin instead of a coin object lookup. */
  useGasCoin?: boolean
  /** gRPC client for on-chain reads this call needs (receipts, vault state). Defaults to a mainnet client. */
  client?: SuiGrpcClient
  /**
   * Minimum shares the deposit must mint, enforced on-chain by Volo's
   * `user_entry::deposit`.
   *
   * NAVI vault deposits have no slippage parameter. This field is currently
   * IGNORED for a NAVI vault — `navi.depositPTB` neither reads nor rejects it, so a
   * non-zero floor silently provides no protection there. Only rely on it for Volo
   * vaults (`vault.source === 'volo'`).
   */
  expectedShares?: bigint
}

export type WithdrawPTBOptions = {
  /** gRPC client for on-chain reads this call needs (receipts, vault state, prices). Defaults to a mainnet client. */
  client?: SuiGrpcClient
}

/**
 * What to withdraw:
 * - `amount` — human-readable decimal string in vault coin units ("1.5"), like `depositPTB`.
 * - `shares` — raw on-chain share count (the unit `VaultPosition.shares` is in).
 * - `all` — everything the owner's receipts hold.
 */
export type WithdrawTarget =
  | { kind: 'amount'; amount: string }
  | { kind: 'shares'; shares: string | bigint }
  | { kind: 'all' }

/**
 * Lists an owner's positions across all vaults.
 *
 * Results are cached for 1s by default and concurrent calls with identical arguments share
 * a single in-flight request. Filtering happens client-side on the full API response, so
 * narrowing by `protocols`/`vaults` does not save a round trip.
 *
 * @param owner - Sui address whose positions to list
 * @param options - Optional filters, environment, and cache overrides
 * @param options.protocols - Restrict the result to these strategy providers. Unset returns every position
 * @param options.vaults - Restrict the result to these vault ids. Unset returns every position
 * @param options.env - Target environment. Only `'prod'` is supported
 * @param options.cacheTime - Cache lifetime in milliseconds. Defaults to 1000
 * @param options.disableCache - Bypass the cache and always refetch
 * @returns Promise<VaultPosition[]> - The owner's positions matching the filters
 * @throws VaultSdkError with code `API_REQUEST_FAILED` (or `RATE_LIMITED` on HTTP 429) when
 *         the API call fails, or `API_RESPONSE_INVALID` when the payload is not an array
 */
export const getPositions = withCache(
  withSingleton(async (owner: string, options?: GetPositionsOptions): Promise<VaultPosition[]> => {
    const url = `${OPEN_API_URL}/vaults/positions?${queryString({
      address: owner
    })}`

    const data = await fetchVaultApiData<VaultPosition[]>(url)
    if (!Array.isArray(data)) {
      throw vaultErrors.apiResponseInvalid(url, 'data is not an array')
    }
    let positions = data

    if (options?.protocols) {
      positions = positions.filter((position) => {
        return options.protocols?.includes(position.protocol)
      })
    }

    if (options?.vaults) {
      positions = positions.filter((position) => {
        return options.vaults?.includes(position.vaultId)
      })
    }

    return positions
  }),
  { defaultCacheTime: 1000 }
)

/**
 * Builds a deposit into the vault, dispatching to the NAVI or Volo builder by `vault.source`.
 *
 * NAVI deposits settle in the same transaction. Volo deposits create a request that an
 * operator executes later, minting shares at that point's rate — see `volo.depositPTB`.
 *
 * @param tx - Transaction to append the deposit calls to
 * @param vaultIdentifier - Vault Sui object id, or an already-fetched `Vault` object
 * @param owner - Sui address the deposit is credited to; its existing receipts are reused when present
 * @param amount - Human-readable decimal string in vault coin units ("1.5", "0.0002"), parsed
 *                 against `vault.assets.baseCoin.decimals`. Raw base-unit flows live on the
 *                 protocol-level builders (`navi.depositPTB` / `volo.depositPTB`)
 * @param options - Optional coin source, client, and slippage floor
 * @param options.coin - Coin object to deposit from. When omitted, one is split from the owner's balance for `amount`
 * @param options.useGasCoin - Split the deposit coin from the transaction's gas coin instead of a coin object lookup
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @param options.expectedShares - Minimum shares the deposit must mint, enforced on-chain by
 *                                 Volo. NAVI vaults have no slippage parameter and currently
 *                                 IGNORE this field — see {@link DepositPTBOptions.expectedShares}
 * @returns Promise<TransactionResult> - The deposit call's result: the vault receipt for NAVI,
 *          `[request_id, Receipt, change]` for Volo
 * @throws VaultSdkError with code `INVALID_AMOUNT` when `amount` is not a positive decimal
 *         within the coin's precision, `VAULT_NOT_FOUND` when the vault does not exist, or
 *         `VAULT_UNSUPPORTED` when its source has no deposit builder
 */
export async function depositPTB(
  tx: Transaction,
  vaultIdentifier: VaultIdentifier,
  owner: string,
  amount: string,
  options?: DepositPTBOptions
): Promise<TransactionResult> {
  const vault = await getVault(vaultIdentifier)
  const amountRaw = parseHumanAmount(amount, vault.assets.baseCoin.decimals)
  switch (vault.source) {
    case 'navi':
      return await navi.depositPTB(tx, vault, owner, amountRaw, options)
    case 'volo':
      return await volo.depositPTB(tx, vault, owner, amountRaw, options)
    default:
      throw vaultErrors.vaultUnsupported(vault.id, 'depositPTB', vault.source)
  }
}

/**
 * Builds a withdrawal from the vault, dispatching to the NAVI or Volo builder by `vault.source`.
 *
 * Returns what the protocol produces: for NAVI vaults the withdrawn coin
 * (`TransactionResult`), for Volo vaults the created request ids (`TransactionResult[]`) —
 * Volo withdrawals settle asynchronously once an operator executes the request. Narrow on
 * `vault.source` (or `Array.isArray`) before consuming the result.
 *
 * Both protocols may split the withdrawal across several of the owner's receipts; NAVI
 * merges the resulting coins into one, Volo returns one request id per receipt drawn from.
 *
 * @param tx - Transaction to append the withdrawal calls to
 * @param vaultIdentifier - Vault Sui object id, or an already-fetched `Vault` object
 * @param owner - Sui address whose receipts are drawn from
 * @param target - What to withdraw; see {@link WithdrawTarget} for the three forms
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<TransactionResult | TransactionResult[]> - The withdrawn coin (NAVI) or the
 *          created request ids (Volo)
 * @throws VaultSdkError with code `INVALID_AMOUNT` when `target` holds a non-positive or
 *         unparsable value, `INSUFFICIENT_BALANCE` when the owner's receipts cannot cover the
 *         request, `VAULT_NOT_FOUND` when the vault does not exist, or `VAULT_UNSUPPORTED`
 *         when its source has no withdrawal builder
 */
export async function withdrawPTB(
  tx: Transaction,
  vaultIdentifier: VaultIdentifier,
  owner: string,
  target: WithdrawTarget,
  options?: WithdrawPTBOptions
): Promise<TransactionResult | TransactionResult[]> {
  const vault = await getVault(vaultIdentifier)

  let normalized:
    | { kind: 'amount'; amount: bigint }
    | { kind: 'shares'; shares: bigint }
    | { kind: 'all' }
  try {
    if (target.kind === 'all') {
      normalized = { kind: 'all' }
    } else if (target.kind === 'shares') {
      const shares = BigInt(target.shares)
      if (shares <= 0n) {
        throw vaultErrors.invalidAmount('withdraw shares must be greater than zero', {
          shares: shares.toString()
        })
      }
      normalized = { kind: 'shares', shares }
    } else {
      normalized = {
        kind: 'amount',
        amount: parseHumanAmount(target.amount, vault.assets.baseCoin.decimals)
      }
    }
  } catch (error) {
    if (isVaultSdkError(error)) throw error
    throw vaultErrors.invalidAmount('withdraw target contains an invalid value', {
      target,
      cause: error instanceof Error ? error.message : String(error)
    })
  }

  switch (vault.source) {
    case 'navi':
      return await navi.withdrawPTB(tx, vault, owner, normalized, options)
    case 'volo':
      return await volo.withdrawPTB(tx, vault, owner, normalized, options)
    default:
      throw vaultErrors.vaultUnsupported(vault.id, 'withdrawPTB', vault.source)
  }
}

/**
 * Lists an owner's claimable/claimed rewards for a vault, one entry per
 * (receipt, reward coin type) pair — the granularity {@link claimRewardsPTB} claims at.
 *
 * Only NAVI vaults have rewards through this path; Volo vaults always resolve to `[]`
 * (Volo has no `navi_vault`-style receipt reward ledger).
 *
 * @param vaultIdentifier - Vault Sui object id, or an already-fetched `Vault` object
 * @param owner - Sui address whose receipts are read
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise<navi.VaultReward[]> - Reward positions ready to pass to `claimRewardsPTB`,
 *          or `[]` for a Volo vault
 * @throws VaultSdkError with code `VAULT_NOT_FOUND` when the vault does not exist, or
 *         `CHAIN_QUERY_FAILED` when an on-chain read fails
 */
export async function getVaultRewards(
  vaultIdentifier: VaultIdentifier,
  owner: string,
  options?: {
    client: SuiGrpcClient
  }
) {
  const vault = await getVault(vaultIdentifier)
  if (vault.source === 'navi') {
    return await navi.getVaultRewards(vault, owner, options)
  }
  return []
}

/**
 * Builds calls to harvest and claim the given NAVI vault rewards.
 *
 * Harvests each distinct vault once, then claims every reward and merges same-coin-type
 * payouts into a single coin per type. The returned coins are unconsumed — the caller must
 * transfer or otherwise use them, or the transaction will fail.
 *
 * @param tx - Transaction to append the harvest and claim calls to
 * @param rewards - Reward positions to claim, as returned by {@link getVaultRewards}. May span
 *                  several receipts and several vaults
 * @param options - Optional client override
 * @param options.client - gRPC client for the on-chain reads this call needs. Defaults to a mainnet client
 * @returns Promise of one entry per distinct `rewardCoinType`, each `{ coin, coinType }` with the
 *          merged claimed coin
 * @throws VaultSdkError with code `VAULT_UNSUPPORTED` when a reward's vault is not a NAVI vault,
 *         or `VAULT_CONFIG_INVALID` when a reward rule's pool or reward fund cannot be resolved
 */
export async function claimRewardsPTB(
  tx: Transaction,
  rewards: navi.VaultReward[],
  options?: {
    client: SuiGrpcClient
  }
) {
  return await navi.claimRewardsPTB(tx, rewards, options)
}

/**
 * Lists an owner's pending (not yet executed) deposit/withdraw requests, as recorded by the
 * NAVI open API.
 *
 * Only Volo vaults produce pending requests — NAVI deposits and withdrawals settle in the
 * same transaction. Entries returned here can be passed to {@link cancelPendingDepositPTB} /
 * {@link cancelPendingWithdrawPTB}. Unlike most reads in this SDK, this one is not cached.
 *
 * @param owner - Sui address whose requests to list
 * @param options - Optional vault filter
 * @param options.vault - Restrict the result to this vault id. Unset returns requests across all vaults
 * @returns Promise<PendingRequest[]> - The owner's outstanding requests
 * @throws VaultSdkError with code `API_REQUEST_FAILED` (or `RATE_LIMITED` on HTTP 429) when
 *         the API call fails, or `API_RESPONSE_INVALID` when the payload is not an array
 */
export async function getPendingRequests(
  owner: string,
  options?: {
    vault?: string
  }
): Promise<PendingRequest[]> {
  const url = `${OPEN_API_URL}/vaults/requests?${queryString({
    address: owner,
    vault: options?.vault
  })}`

  const data = await fetchVaultApiData<PendingRequest[]>(url)
  if (!Array.isArray(data)) {
    throw vaultErrors.apiResponseInvalid(url, 'data is not an array')
  }
  return data
}

/**
 * Shared body of the two cancel entry points: validates the request direction, resolves the
 * vault, and builds the matching `user_entry::cancel_*` call.
 *
 * @param tx - Transaction to append the cancel call to
 * @param request - The pending request to cancel
 * @param expectedType - Direction the caller's entry point handles; `request.type` must match
 */
async function cancelPendingRequestPTB(
  tx: Transaction,
  request: PendingRequest,
  expectedType: 'deposit' | 'withdraw'
) {
  if (request.type !== expectedType) {
    throw vaultErrors.invalidRequestType(expectedType, request.type)
  }
  const vault = await getVault(request.vaultId)
  if (!vault.volo) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'missing Volo package configuration')
  }
  return tx.moveCall({
    target: `${vault.volo.package}::user_entry::cancel_${expectedType}`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(request.vaultId),
      tx.object(request.receiptId),
      tx.pure.u64(request.requestId),
      tx.object('0x6')
    ]
  })
}

/**
 * Builds a cancellation of a pending Volo deposit request.
 *
 * The on-chain call aborts if an operator already executed the request, or if the vault's
 * cancel lock has not yet expired (`request.executeTime`).
 *
 * @param tx - Transaction to append the cancel call to
 * @param request - The pending deposit request, from {@link getPendingRequests}. Its `type`
 *                  must be `'deposit'`
 * @returns Promise<TransactionResult> - The refunded principal coin. The caller must consume it
 *          (e.g. transfer it back to the owner), or the transaction will fail
 * @throws VaultSdkError with code `INVALID_REQUEST_TYPE` when `request.type` is not `'deposit'`,
 *         `VAULT_NOT_FOUND` when the vault does not exist, or `VAULT_CONFIG_INVALID` when it
 *         carries no Volo package configuration
 */
export async function cancelPendingDepositPTB(tx: Transaction, request: PendingRequest) {
  return await cancelPendingRequestPTB(tx, request, 'deposit')
}

/**
 * Builds a cancellation of a pending Volo withdraw request.
 *
 * The on-chain call aborts if an operator already executed the request, or if the vault's
 * cancel lock has not yet expired (`request.executeTime`).
 *
 * @param tx - Transaction to append the cancel call to
 * @param request - The pending withdraw request, from {@link getPendingRequests}. Its `type`
 *                  must be `'withdraw'`
 * @returns Promise<TransactionResult> - The cancelled share count (u256), returned to the receipt
 * @throws VaultSdkError with code `INVALID_REQUEST_TYPE` when `request.type` is not `'withdraw'`,
 *         `VAULT_NOT_FOUND` when the vault does not exist, or `VAULT_CONFIG_INVALID` when it
 *         carries no Volo package configuration
 */
export async function cancelPendingWithdrawPTB(tx: Transaction, request: PendingRequest) {
  return await cancelPendingRequestPTB(tx, request, 'withdraw')
}
