/**
 * Lending Utilities
 *
 * This module provides utility functions for the lending protocol, including
 * caching mechanisms, data transformation, transaction parsing, and blockchain
 * interaction helpers.
 *
 * @module LendingUtils
 */

import type { SuiClientOption, CacheOption, Pool, TransactionResult } from './types'
import type { DevInspectResults } from '@mysten/sui/client'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import camelCase from 'lodash.camelcase'
import { Transaction } from '@mysten/sui/transactions'
import { BcsType } from '@mysten/sui/bcs'
import { normalizeStructTag } from '@mysten/sui/utils'
import { SuiPriceServiceConnection } from '@pythnetwork/pyth-sui-js'

/**
 * Default Sui client instance configured for mainnet
 */
export const suiClient = new SuiClient({
  url: getFullnodeUrl('mainnet')
})

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
  let argsCopy = JSON.parse(JSON.stringify(args))
  const options = argsCopy[argsCopy.length - 1] as Partial<CacheOption & SuiClientOption>
  if (!!options && typeof options === 'object') {
    delete options.cacheTime
    delete options.disableCache
    delete options.client
    if (Object.keys(options).length === 0) {
      argsCopy = argsCopy.slice(0, -1)
    }
  }

  return JSON.stringify(argsCopy)
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
    if (!promiseMap[key]) {
      promiseMap[key] = fn(...args).finally(() => {
        promiseMap[key] = null
      })
    }
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
      data: undefined
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
        return cacheData.data
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

/**
 * Converts object keys from snake_case to camelCase recursively
 *
 * This function transforms all keys in an object (including nested objects and arrays)
 * from snake_case format to camelCase format.
 *
 * @param obj - Object to transform
 * @returns Object with camelCase keys
 */
export function camelize<T extends Record<string, any>>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((v) => camelize(v)) as unknown as T
  } else if (obj != null && typeof obj === 'object') {
    return Object.keys(obj).reduce(
      (result, key) => ({
        ...result,
        [camelCase(key)]: camelize(obj[key])
      }),
      {} as T
    )
  }
  return obj
}

/**
 * Parses a value for use in transaction building
 *
 * This function converts various value types into the appropriate format
 * for transaction building, handling both primitive types and existing
 * transaction results.
 *
 * @param value - Value to parse (string, number, boolean, or object)
 * @param format - Format function to apply to the value
 * @returns Transaction result in the appropriate format
 */
export function parseTxVaule(
  value: string | number | boolean | object,
  format: any
): TransactionResult {
  if (typeof value === 'object') {
    return value as TransactionResult
  }
  return format(value) as TransactionResult
}

/**
 * Parses a pool value for use in transaction building
 *
 * This function handles different pool representations and converts them
 * to the appropriate transaction object format.
 *
 * @param tx - Transaction object to build
 * @param value - Pool value (string, Pool object, or TransactionResult)
 * @returns Transaction result representing the pool
 */
export function parseTxPoolVaule(tx: Transaction, value: string | Pool | TransactionResult) {
  if (typeof value === 'string') {
    return tx.object(value)
  }
  if (typeof value === 'object' && (value as TransactionResult).$kind) {
    return value as TransactionResult
  }
  return tx.object((value as Pool).contract.pool)
}

/**
 * Parses the result of a devInspectTransactionBlock call
 *
 * This function extracts and parses return values from transaction inspection
 * results using BCS (Binary Canonical Serialization) types.
 *
 * @param data - DevInspectResults from transaction inspection
 * @param parseTypes - Array of BCS types to parse the return values
 * @param options - Optional configuration including error handling
 * @returns Parsed result data
 */
export function parseDevInspectResult<T>(
  data: DevInspectResults,
  parseTypes: BcsType<any>[],
  options?: {
    throwError?: boolean
  }
): T {
  if (data.results && data.results.length > 0) {
    if (data.results[0].returnValues && data.results[0].returnValues.length > 0) {
      return data.results[0].returnValues.map((item, index) => {
        const parseType = parseTypes[index] || parseTypes[0]
        return parseType.parse(Uint8Array.from(item[0]))
      }) as T
    }
  } else if (data.error) {
    console.log(`Get an error, msg: ${data.error}`)
    if (options?.throwError) {
      throw new Error(data.error)
    }
    return [] as T
  }
  return [] as T
}

/**
 * Normalizes a coin type string using Sui's struct tag normalization
 *
 * @param coinType - Coin type string to normalize
 * @returns Normalized coin type string
 */
export function normalizeCoinType(coinType: string) {
  return normalizeStructTag(coinType)
}

/**
 * Processes health factor values from contract format to human-readable format
 *
 * This function converts the raw health factor value from the contract
 * (which is typically a large integer) to a more readable decimal format.
 *
 * @param hf - Raw health factor value from contract
 * @returns Processed health factor value
 */
export function processContractHealthFactor(hf: number) {
  const healthFactor = (hf || 0) / Math.pow(10, 27)
  if (healthFactor > Math.pow(10, 5)) {
    return Infinity
  }
  return healthFactor
}

/**
 * Pyth price service connection for oracle price feeds
 *
 * This connection is used to fetch real-time price data from the Pyth network
 * for various assets in the lending protocol.
 */
export const suiPythConnection = new SuiPriceServiceConnection('https://hermes.pyth.network', {
  timeout: 20000
})
