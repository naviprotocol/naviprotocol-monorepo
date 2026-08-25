import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { CacheOption } from './types'
import { TransactionResult } from '@mysten/sui/transactions'

/**
 * Generates a cache key from function arguments
 *
 * This function creates a unique key for caching by serializing the arguments
 * and removing cache-specific options that shouldn't affect the cache key.
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
 * @param fn - Function to wrap with singleton behavior
 * @returns Wrapped function with singleton behavior
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
 * @param fn - Function to wrap with caching behavior
 * @returns Wrapped function with caching behavior
 */
export function withCache<T extends (...args: any[]) => Promise<any>>(fn: T): T {
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

    // Check if cache is valid and not disabled
    if (!options?.disableCache && typeof cacheData?.data !== 'undefined') {
      if (
        typeof options?.cacheTime === 'undefined' ||
        options.cacheTime > Date.now() - cacheData.cacheAt
      ) {
        // Wrap in Promise.resolve to honor the declared `Promise<any>` return type.
        // Returning the cached value synchronously breaks `.then()` chaining at call sites.
        return Promise.resolve(cacheData.data)
      }
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

export function queryString(params: Record<string, any>) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  )
}

export function getSuiClient(client?: SuiGrpcClient) {
  return (
    client ||
    new SuiGrpcClient({
      network: 'mainnet',
      baseUrl: 'https://fullnode.mainnet.sui.io:443'
    })
  )
}

export function parseTxValue(
  value: string | number | boolean | object | null | undefined | bigint,
  format: any
): TransactionResult {
  if (value === undefined || value === null) {
    throw new Error('Transaction value is required')
  }
  if (typeof value === 'object') {
    return value as TransactionResult
  }
  return format(value) as TransactionResult
}
