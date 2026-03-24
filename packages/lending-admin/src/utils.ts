import type { CacheOption } from './types'
import packageJson from '../package.json'

const sdkVersion = packageJson.version

function argsKey(args: any[]) {
  const serializedArgs = [] as any[]
  args.forEach((option: any, index) => {
    const isLast = index === args.length - 1
    if (typeof option === 'object' && option !== null && isLast) {
      const { disableCache, cacheTime, ...rest } = option
      serializedArgs.push(rest)
    } else {
      serializedArgs.push(option)
    }
  })
  return JSON.stringify(serializedArgs)
}

const getNodeInfo = (): string => {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const os = require('os')
      const nodeVersion: string = process.version
      const osType: string = os.type()
      const osArch: string = os.arch()
      const formattedNodeVersion = nodeVersion.startsWith('v')
        ? nodeVersion.substring(1)
        : nodeVersion
      return `Node.js ${formattedNodeVersion}; ${osType}/${osArch}`
    } catch {
      return `Node.js ${process.version}; OS/Unknown`
    }
  }

  return 'Node/Unknown'
}

export const getUserAgent = (): string => {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node
  if (!isNode) {
    return ''
  }

  return `lending-admin/${sdkVersion} (${getNodeInfo()})`
}

export const userAgent = getUserAgent()

export const requestHeaders = !!userAgent
  ? {
      'User-Agent': userAgent
    }
  : ({} as HeadersInit)

export function withSingleton<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  const promiseMap = new Map<string, Promise<any>>()

  return ((...args: any[]) => {
    const key = argsKey(args)
    const pending = promiseMap.get(key)

    if (pending) {
      return pending
    }

    const next = fn(...args).finally(() => {
      promiseMap.delete(key)
    })
    promiseMap.set(key, next)
    return next
  }) as T
}

export function withCache<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  const cache = new Map<string, { data: Awaited<ReturnType<T>>; cacheAt: number }>()

  return ((...args: any[]) => {
    const options = args[args.length - 1] as Partial<CacheOption> | undefined
    const key = argsKey(args)
    const cacheData = cache.get(key)

    if (!options?.disableCache && cacheData) {
      if (
        typeof options?.cacheTime === 'undefined' ||
        options.cacheTime > Date.now() - cacheData.cacheAt
      ) {
        return Promise.resolve(cacheData.data)
      }
    }

    return fn(...args).then((result) => {
      cache.set(key, {
        data: result,
        cacheAt: Date.now()
      })
      return result
    })
  }) as T
}
