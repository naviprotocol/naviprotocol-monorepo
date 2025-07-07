import type { Transaction } from '@mysten/sui/transactions'
import type {
  EnvOption,
  AssetIdentifier,
  CoinObject,
  CacheOption,
  FloashloanAsset,
  TransactionResult
} from './types'
import { DEFAULT_CACHE_TIME, getConfig } from './config'
import { parseTxVaule, normalizeCoinType, withCache, withSingleton } from './utils'
import { getPool } from './pool'

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
        return normalizeCoinType(asset.coinType) === normalizeCoinType(identifier)
      }
      if (typeof identifier === 'number') {
        return asset.assetId === identifier
      }
      return asset.assetId === identifier.id
    }) || null
  )
}

export async function flashloanPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const flashLoanAssets = await getAllFlashLoanAssets({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const isSupport = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(pool.suiCoinType)
  )

  if (!isSupport) {
    throw new Error('Pool does not support flashloan')
  }

  const [balance, receipt] = tx.moveCall({
    target: `${config.package}::lending::flash_loan_with_ctx`,
    arguments: [
      tx.object(config.flashloanConfig),
      tx.object(pool.contract.pool),
      parseTxVaule(amount, tx.pure.u64)
    ],
    typeArguments: [pool.suiCoinType]
  })

  return [balance, receipt]
}

export async function repayFlashLoanPTB(
  tx: Transaction,
  identifier: AssetIdentifier,
  receipt: TransactionResult | string,
  coinObject: CoinObject,
  options?: Partial<EnvOption>
) {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pool = await getPool(identifier, options)

  const flashLoanAssets = await getAllFlashLoanAssets({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })

  const isSupport = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(pool.suiCoinType)
  )

  if (!isSupport) {
    throw new Error('Pool does not support flashloan')
  }

  const [balance] = tx.moveCall({
    target: `${config.package}::lending::flash_repay_with_ctx`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      parseTxVaule(receipt, tx.object),
      parseTxVaule(coinObject, tx.object)
    ],
    typeArguments: [pool.suiCoinType]
  })
  return [balance]
}
