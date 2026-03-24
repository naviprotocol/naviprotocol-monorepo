import { Transaction } from '@mysten/sui/transactions'
import type { TransactionResult } from '@mysten/sui/transactions'
import { getAdminConfig } from './config'
import { getReserveByAssetId, getReserveByCoinType } from './resolvers'
import type { AdminConfig, CacheOption, EnvOption, MarketOption, ReserveMetadata } from './types'

export const CLOCK_OBJECT_ID = '0x6'
export const SUI_SYSTEM_STATE_OBJECT_ID = '0x5'
export const SUI_COIN_TYPE = '0x2::sui::SUI'

export type AdminPTBOptions = Partial<EnvOption & CacheOption & MarketOption> & {
  tx?: Transaction
  config?: AdminConfig
  clock?: string
  suiSystemState?: string
}

export type ReserveSelector =
  | {
      assetId: number
      coinType?: never
    }
  | {
      assetId?: never
      coinType: string
    }

export type PTBObjectArgument = string | TransactionResult

export async function resolveAdminPTBContext(options?: AdminPTBOptions) {
  const config = options?.config ?? (await getAdminConfig(options))
  return {
    tx: options?.tx ?? new Transaction(),
    config,
    clock: options?.clock ?? CLOCK_OBJECT_ID,
    suiSystemState: options?.suiSystemState ?? SUI_SYSTEM_STATE_OBJECT_ID
  }
}

export function resolveReserveSelection(
  config: Pick<AdminConfig, 'reserveMetadata'>,
  selector: ReserveSelector
): ReserveMetadata {
  if (typeof selector.assetId === 'number') {
    return getReserveByAssetId(config, selector.assetId)
  }

  return getReserveByCoinType(config, selector.coinType)
}

export function resolveSuiReserve(config: Pick<AdminConfig, 'reserveMetadata'>) {
  return getReserveByCoinType(config, SUI_COIN_TYPE)
}

export function resolveOracleFeedByOracleId(config: Pick<AdminConfig, 'oracle'>, oracleId: number) {
  const feed = config.oracle.feeds.find((item) => item.oracleId === oracleId)
  if (!feed) {
    throw new Error(`Oracle feed not found for oracleId ${oracleId}`)
  }

  return feed
}

export function resolveOracleFeedByFeedId(config: Pick<AdminConfig, 'oracle'>, feedId: string) {
  const feed = config.oracle.feeds.find((item) => item.feedId === feedId)
  if (!feed) {
    throw new Error(`Oracle feed not found for feedId ${feedId}`)
  }

  return feed
}

export function lendingTarget(config: AdminConfig, moduleName: string, functionName: string) {
  return `${config.lending.package}::${moduleName}::${functionName}`
}

export function oracleTarget(config: AdminConfig, moduleName: string, functionName: string) {
  return `${config.oracle.packageId}::${moduleName}::${functionName}`
}

export function resolveObjectArgument(tx: Transaction, value: PTBObjectArgument) {
  return typeof value === 'string' ? tx.object(value) : value
}
