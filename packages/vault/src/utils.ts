import { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseToUnits } from '@mysten/sui/utils'
import type { CacheOption } from './types'
import { TransactionResult } from '@mysten/sui/transactions'
import { vaultErrors } from './error'

/**
 * Parses a human-readable decimal amount ("1.5", "0.00020497") into raw base units.
 *
 * The public deposit/withdraw entry points take human-unit decimal strings; raw
 * base-unit flows live on the protocol-level builders instead.
 *
 * @param amount - Decimal string in human units, e.g. `"1.5"` or `"0.00020497"`
 * @param decimals - The coin's decimal places, from `vault.assets.baseCoin.decimals`
 * @returns The amount in raw base units
 * @throws VaultSdkError with code `INVALID_AMOUNT` when the string is not a valid decimal,
 *         has more fractional digits than `decimals`, or is not strictly positive
 */
export function parseHumanAmount(amount: string, decimals: number): bigint {
  let raw: bigint
  try {
    raw = parseToUnits(amount, decimals)
  } catch (error) {
    throw vaultErrors.invalidAmount(
      `amount must be a decimal string with at most ${decimals} decimal places`,
      { amount, cause: error instanceof Error ? error.message : String(error) }
    )
  }
  if (raw <= 0n) {
    throw vaultErrors.invalidAmount('amount must be greater than zero', { amount })
  }
  return raw
}

/**
 * Splits a single total across several calls in proportion to `weights`.
 *
 * Both protocols may spread one withdrawal over several receipts, and each contract call
 * carries its own payout floor — so a caller's one `minAmountOut` has to be divided among
 * them, or every call would have to clear the whole floor on its own. Floor division leaves
 * a remainder of at most `weights.length - 1`, which goes on the last entry so the parts
 * sum to exactly `total`.
 *
 * @param total - The value to divide, in raw base units
 * @param weights - One non-negative weight per call, in call order
 * @returns One share per weight, summing to `total`; all zeroes when `total` or the weights
 *          sum to zero
 */
export function apportion(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((carry, weight) => carry + weight, 0n)
  if (total <= 0n || sum <= 0n) return weights.map(() => 0n)
  const shares = weights.map((weight) => (total * weight) / sum)
  const assigned = shares.reduce((carry, share) => carry + share, 0n)
  shares[shares.length - 1] += total - assigned
  return shares
}

/**
 * Generates a cache key from function arguments
 *
 * This function creates a unique key for caching by serializing the arguments
 * and removing cache-specific options that shouldn't affect the cache key.
 *
 * Only a trailing object argument is stripped, and only of `client`, `disableCache`, and
 * `cacheTime` — a client instance would not serialize, and the cache flags describe how to
 * fetch rather than what is fetched.
 *
 * @param args - Function arguments to generate key from
 * @returns JSON string representing the arguments
 */
function argsKey(args: any[]) {
  const serializedArgs = [] as any[]

  args.forEach((option: any, index) => {
    const isLast = index === args.length - 1
    if (typeof option === 'object' && option !== null && isLast) {
      const { client, disableCache, cacheTime, ...rest } = option
      serializedArgs.push(rest)
    } else {
      serializedArgs.push(option)
    }
  })

  return JSON.stringify(serializedArgs)
}

/**
 * Wraps a function with singleton behavior to prevent duplicate concurrent calls
 *
 * This decorator ensures that if the same function is called with the same arguments
 * while a previous call is still pending, it returns the existing promise instead
 * of making a new call.
 *
 * Arguments are keyed by {@link argsKey}, which ignores `client`, `disableCache`, and
 * `cacheTime` on a trailing options object.
 *
 * @typeParam T - Signature of the wrapped async function, preserved by the wrapper
 * @param fn - Function to wrap with singleton behavior
 * @returns Wrapped function with singleton behavior, with `fn`'s signature
 */
export function withSingleton<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  const promiseMap: Record<string, Promise<any> | null> = {}

  return ((...args: any[]) => {
    const key = argsKey(args)
    if (promiseMap[key]) {
      return promiseMap[key]
    }
    promiseMap[key] = fn(...args).finally(() => {
      delete promiseMap[key]
    })
    return promiseMap[key]
  }) as T
}

/**
 * Wraps a function with caching behavior
 *
 * This decorator caches function results based on arguments and cache options.
 * It respects cache time settings and can be disabled per call.
 *
 * Per-call behavior is read off the LAST argument, which is expected to be a
 * {@link CacheOption}-shaped options object: `cacheTime` overrides the default lifetime and
 * `disableCache` bypasses the cache entirely. Arguments are keyed by {@link argsKey}.
 *
 * @typeParam T - Signature of the wrapped async function, preserved by the wrapper
 * @param fn - Function to wrap with caching behavior
 * @param defaults - Fallback cache settings for calls that pass no `cacheTime`
 * @param defaults.defaultCacheTime - Default entry lifetime in milliseconds. Without it an
 *        entry never expires, which is wrong for vault data that feeds money math
 *        (share/asset conversions)
 * @returns Wrapped function with caching behavior, with `fn`'s signature
 */
export function withCache<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  defaults?: { defaultCacheTime?: number }
): T {
  let cache: Record<
    string,
    {
      data: any
      cacheAt: number
    }
  > = {}

  return ((...args: any[]) => {
    const options = args[args.length - 1] as Partial<CacheOption>
    const key = argsKey(args)
    const cacheData = cache[key]
    const cacheTime = options?.cacheTime ?? defaults?.defaultCacheTime

    // Check if cache is valid and not disabled
    if (!options?.disableCache && typeof cacheData?.data !== 'undefined') {
      if (typeof cacheTime === 'undefined' || cacheTime > Date.now() - cacheData.cacheAt) {
        // Wrap in Promise.resolve to honor the declared `Promise<any>` return type.
        // Returning the cached value synchronously breaks `.then()` chaining at call sites.
        return Promise.resolve(cacheData.data)
      }
      // Expired entries are dropped on read so per-argument keys (owners, vaults)
      // don't accumulate for the process lifetime.
      delete cache[key]
    }

    // Execute function and cache result
    return fn(...args).then((result) => {
      cache[key] = {
        data: result,
        cacheAt: Date.now()
      }
      return result
    })
  }) as T
}

/**
 * Builds a URL query string, dropping any parameter whose value is `undefined` so optional
 * filters can be passed through unconditionally. Remaining values are stringified.
 *
 * @param params - Query parameters; `undefined` values are omitted
 * @returns URLSearchParams - Stringifies to the encoded query, without a leading `?`
 */
export function queryString(params: Record<string, any>) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  )
}

/**
 * Resolves the gRPC client every on-chain read in this SDK goes through.
 *
 * @param client - Caller-supplied client, returned unchanged when present
 * @returns The supplied client, or a new `SuiGrpcClient` against the public mainnet fullnode
 */
export function getSuiClient(client?: SuiGrpcClient) {
  return (
    client ||
    new SuiGrpcClient({
      network: 'mainnet',
      baseUrl: 'https://fullnode.mainnet.sui.io:443'
    })
  )
}

/**
 * Fetches `url` and unwraps the NAVI open API's `{ data: T }` envelope.
 *
 * The `data` payload is returned unvalidated — callers are expected to check its shape and
 * raise `apiResponseInvalid` themselves, since the expected shape differs per endpoint.
 *
 * @typeParam T - Expected shape of the response's `data` field. Not verified at runtime
 * @param url - Fully-built request URL, including any query string
 * @returns Promise<T> - The response body's `data` field
 * @throws VaultSdkError with code `API_REQUEST_FAILED` (or `RATE_LIMITED` on HTTP 429) on a
 *         network error or non-2xx response, or `API_RESPONSE_INVALID` when the body is not
 *         JSON or has no `data` field
 */
export async function fetchVaultApiData<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: {} })
  } catch (error) {
    throw vaultErrors.apiRequestFailed(url, error)
  }

  if (!response.ok) {
    throw vaultErrors.apiRequestFailed(url, undefined, response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw vaultErrors.apiResponseInvalid(url, 'response body is not valid JSON', error)
  }

  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw vaultErrors.apiResponseInvalid(url, 'response body has no data field')
  }

  return (body as { data: T }).data
}

/**
 * Normalizes a value into a Move call argument, so builders can accept either a literal or
 * the result of an earlier call in the same PTB.
 *
 * Primitives are serialized through `format`; an already-built `TransactionResult` (any
 * object) is passed through untouched.
 *
 * @param value - Literal to serialize, or an existing `TransactionResult` to pass through
 * @param format - Serializer applied to primitives, e.g. `tx.pure.u64` or `tx.object`
 * @returns The argument, ready to place in a `moveCall`'s `arguments`
 * @throws VaultSdkError with code `INVALID_ARGUMENT` when `value` is `null` or `undefined`
 */
export function parseTxValue(
  value: string | number | boolean | object | null | undefined | bigint,
  format: any
): TransactionResult {
  if (value === undefined || value === null) {
    throw vaultErrors.invalidArgument('transaction value', 'value is required')
  }
  if (typeof value === 'object') {
    return value as TransactionResult
  }
  return format(value) as TransactionResult
}
