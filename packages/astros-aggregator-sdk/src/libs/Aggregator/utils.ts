import CryptoJS from 'crypto-js'
import { CacheOption } from '../../types'

// Reserved ref_id
const RESERVED_IDS_ARRAY = [1873161113, 8190801341]
const RESERVED_REF_IDS = new Set<number>(RESERVED_IDS_ARRAY)

// Keep 10 decimal digits
const REF_ID_MOD = 10 ** 10

/**
 * Generates a unique reference ID based on the provided API key.
 * The reference ID is derived from the SHA-256 hash of the API key,
 * ensuring it is a 10-digit decimal number and does not conflict with reserved IDs.
 *
 * @param {string} apiKey - The API key used to generate the reference ID.
 * @returns {number} A unique reference ID.
 */
export function generateRefId(apiKey: string): number {
  // Use SHA-256 to hash the apiKey with crypto-js
  const digest = CryptoJS.SHA256(apiKey).toString(CryptoJS.enc.Hex)

  // Extract the first 16 hexadecimal characters (corresponding to 8 bytes) and convert them to an integer
  let refIdCandidate = parseInt(digest.slice(0, 16), 16)

  // Limit to 10 decimal digits
  refIdCandidate = refIdCandidate % REF_ID_MOD

  // Avoid conflicts with reserved ref_id
  let finalRefId = refIdCandidate

  // Try increasing offset each time and take modulo to stay within 10 digits
  while (RESERVED_REF_IDS.has(finalRefId)) {
    throw new Error('Ref ID conflict, please try a new apiKey')
  }

  return finalRefId
}

/**
 * Parses the type arguments from a pool type string
 *
 * @param poolTypeStr - The pool type string
 * @returns The type arguments
 */
export function parsePoolTypeArgs(poolTypeStr: string): string[] {
  // example1: "0x...::pool::Pool<0x...::USDC, 0x2::sui::SUI>"
  // example2: turbos "Pool<0x549...::CERT, 0x2::sui::SUI, 0x91b...::FEE500BPS>"
  const match = poolTypeStr.match(/<(.+)>/)

  if (!match) {
    throw new Error(`Bad pool type: ${poolTypeStr}`)
  }

  const innerContent = match[1]

  return innerContent.split(',').map((arg) => arg.trim())
}

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
  const serializergs = [] as any[]
  args.forEach((option: any, index) => {
    const isLast = index === args.length - 1
    if (typeof option === 'object' && isLast) {
      const { client, disableCache, cacheTime, ...rest } = option
      serializergs.push(rest)
    } else {
      serializergs.push(option)
    }
  })
  return JSON.stringify(serializergs)
}

/**
 * Wraps a function with singleton behavior
 *
 * This decorator ensures that only one instance of the function is running at a time.
 * If the function is called again while a previous call is still pending, it returns
 * the existing promise instead of making a new call.
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
