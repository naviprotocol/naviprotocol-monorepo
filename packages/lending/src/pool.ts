import type {
  EnvOption,
  CacheOption,
  Pool,
  AssetIdentifier,
  FloashloanAsset,
  PoolStats,
  FeeDetail
} from './types'
import { withCache, withSingleton } from './utils'

export enum PoolOperator {
  Supply = 1,
  Withdraw = 2,
  Borrow = 3,
  Repay = 4
}

export const getPools = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<Pool[]> => {
    const url = `https://open-api.naviprotocol.io/api/navi/pools?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

export const getAllFlashLoanAssets = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<FloashloanAsset[]> => {
    const url = `https://open-api.naviprotocol.io/api/navi/flashloan?env=${options?.env || 'prod'}`
    const res = await fetch(url).then((res) => res.json())
    return Object.keys(res.data).map((coinType) => {
      return {
        ...res.data[coinType],
        coinType
      }
    })
  })
)

export async function getFlashLoanAsset(
  identifier: AssetIdentifier,
  options?: Partial<EnvOption>
): Promise<FloashloanAsset | null> {
  const assets = await getAllFlashLoanAssets(options)
  return (
    assets.find((asset) => {
      if (typeof identifier === 'string') {
        return asset.coinType === identifier
      }
      if (typeof identifier === 'number') {
        return asset.assetId === identifier
      }
      return asset.assetId === identifier.id
    }) || null
  )
}

export const getStats = withCache(
  withSingleton(async (options?: Partial<CacheOption>): Promise<PoolStats> => {
    const url = `https://open-api.naviprotocol.io/api/navi/stats`
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

export const getFees = withCache(
  withSingleton(
    async (
      options?: Partial<CacheOption>
    ): Promise<{
      totalValue: string
      v3BorrowFee: {
        totalValue: number
        details: FeeDetail[]
      }
      borrowInterestFee: {
        totalValue: number
        details: FeeDetail[]
      }
      flashloanAndLiquidationFee: {
        totalValue: number
        details: FeeDetail[]
      }
    }> => {
      const url = `https://open-api.naviprotocol.io/api/navi/fee`
      const res = await fetch(url).then((res) => res.json())
      return res
    }
  )
)
