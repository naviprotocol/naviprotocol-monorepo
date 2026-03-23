import type { CacheOption, TransactionResult } from './types'
import { userAgent } from './ua'

function argsKey(args: any[]) {
  const serializergs = [] as any[]
  args.forEach((option: any, index) => {
    const isLast = index === args.length - 1
    if (typeof option === 'object' && option !== null && isLast) {
      const { client, disableCache, cacheTime, ...rest } = option
      serializergs.push(rest)
    } else {
      serializergs.push(option)
    }
  })
  return JSON.stringify(serializergs)
}

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

    if (!options?.disableCache && typeof cacheData?.data !== 'undefined') {
      if (
        typeof options?.cacheTime === 'undefined' ||
        options.cacheTime > Date.now() - cacheData.cacheAt
      ) {
        return cacheData.data
      }
    }

    return fn(...args).then((result) => {
      cache[key] = {
        data: result,
        cacheAt: Date.now()
      }
      return result
    })
  }) as T
}

export function parseTxValue(
  value: string | number | boolean | bigint | object,
  format: any
): TransactionResult {
  if (typeof value === 'object') {
    return value as TransactionResult
  }
  return format(value) as TransactionResult
}

export const requestHeaders = !!userAgent
  ? {
      'User-Agent': userAgent
    }
  : ({} as HeadersInit)
