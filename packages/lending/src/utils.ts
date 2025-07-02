import type { SuiClientOption, CacheOption } from './types'
import type { CoinStruct } from '@mysten/sui/client'
import BigNumber from 'bignumber.js'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

export const suiClient = new SuiClient({
  url: getFullnodeUrl('mainnet')
})

export async function getUserCoins(
  address: string,
  options?: Partial<
    {
      coinType?: string
    } & SuiClientOption
  >
): Promise<CoinStruct[]> {
  return []
}

export function rayMathMulIndex(
  amount: string | number | BigNumber,
  index: string | number | BigNumber
): BigNumber {
  return new BigNumber(0)
}

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
