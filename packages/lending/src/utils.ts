import type { SuiClientOption, CacheOption, Pool } from './types'
import type { CoinStruct, DevInspectResults } from '@mysten/sui/client'
import BigNumber from 'bignumber.js'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import camelCase from 'lodash.camelcase'
import { TransactionResult, Transaction } from '@mysten/sui/transactions'
import { bcs, BcsType, pureBcsSchemaFromTypeName } from '@mysten/sui/bcs'
import { normalizeStructTag } from '@mysten/sui/utils'

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
  let cursor: string | undefined | null = null
  const allCoinDatas: CoinStruct[] = []
  const client = options?.client ?? suiClient
  do {
    const { data, nextCursor } = await client.getCoins({
      owner: address,
      coinType: options?.coinType,
      cursor,
      limit: 100
    })
    if (!data || !data.length) {
      break
    }
    allCoinDatas.push(...data)
    cursor = nextCursor
  } while (cursor)
  return allCoinDatas
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

export function parseTxVaule(
  value: string | number | boolean | TransactionResult,
  format: any
): TransactionResult {
  if (typeof value === 'object' && value.$kind) {
    return value
  }
  return format(value) as TransactionResult
}

export function parseTxPoolVaule(tx: Transaction, value: string | Pool | TransactionResult) {
  if (typeof value === 'string') {
    return tx.object(value)
  }
  if (typeof value === 'object' && (value as TransactionResult).$kind) {
    return value as TransactionResult
  }
  return tx.object((value as Pool).contract.pool)
}

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

export function normalizeCoinType(coinType: string) {
  return normalizeStructTag(coinType)
}

export function processContractHealthFactor(hf: number) {
  const healthFactor = (hf || 0) / Math.pow(10, 27)
  if (healthFactor > Math.pow(10, 5)) {
    return Infinity
  }
  return healthFactor
}
