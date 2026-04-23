import { normalizeStructTag } from '@mysten/sui/utils'
import type { AdminConfig, LendingAdminConfig, ReserveMetadata } from './types'

type AdminConfigSlice = Pick<AdminConfig, 'lending' | 'reserveMetadata'>

function normalizeCoinType(coinType: string) {
  return normalizeStructTag(coinType)
}

function findReserve(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  predicate: (reserve: ReserveMetadata) => boolean,
  errorMessage: string
) {
  const reserve = config.reserveMetadata.find(predicate)
  if (!reserve) {
    throw new Error(errorMessage)
  }

  return reserve
}

export function getReserveByAssetId(config: Pick<AdminConfig, 'reserveMetadata'>, assetId: number) {
  return findReserve(
    config,
    (reserve) => reserve.assetId === assetId,
    `Reserve not found for assetId ${assetId}`
  )
}

export function getReserveByCoinType(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  coinType: string
) {
  const normalizedCoinType = normalizeCoinType(coinType)
  return findReserve(
    config,
    (reserve) => normalizeCoinType(reserve.coinType) === normalizedCoinType,
    `Reserve not found for coinType ${coinType}`
  )
}

export function getReserveByPoolId(config: Pick<AdminConfig, 'reserveMetadata'>, poolId: number) {
  return findReserve(
    config,
    (reserve) => reserve.poolId === poolId,
    `Reserve not found for poolId ${poolId}`
  )
}

export function getReserveByPool(config: Pick<AdminConfig, 'reserveMetadata'>, pool: string) {
  return findReserve(
    config,
    (reserve) => reserve.pool === pool,
    `Reserve not found for pool ${pool}`
  )
}

export function resolvePoolAddressByAssetId(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  assetId: number
) {
  return getReserveByAssetId(config, assetId).pool
}

export function resolvePoolAddressByCoinType(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  coinType: string
) {
  return getReserveByCoinType(config, coinType).pool
}

export function resolvePoolIdByAssetId(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  assetId: number
) {
  return getReserveByAssetId(config, assetId).poolId
}

export function resolvePoolIdByCoinType(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  coinType: string
) {
  return getReserveByCoinType(config, coinType).poolId
}

export function resolveDecimalsByAssetId(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  assetId: number
) {
  return getReserveByAssetId(config, assetId).decimals
}

export function resolveDecimalsByCoinType(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  coinType: string
) {
  return getReserveByCoinType(config, coinType).decimals
}

export function resolveLendingAdminCap(
  config: AdminConfigSlice,
  capName: keyof Pick<
    LendingAdminConfig,
    'poolAdminCap' | 'storageAdminCap' | 'ownerCap' | 'incentiveOwnerCap'
  >
) {
  return config.lending[capName]
}
