/**
 * DCA (Dollar-Cost Averaging) Module
 *
 * This module provides SDK functions for creating and managing DCA orders
 * using Astros aggregator's routing capabilities.
 */

export { createDcaOrder } from './createDcaOrder'
export { getCoinForDca } from './coinUtils'
export { cancelDcaOrder } from './cancelDcaOrder'
export { dryRunDcaTransaction } from './simulate'
export type { NaviDcaDryRunResult } from './simulate'
export type {
  NaviDcaCoinClient,
  NaviDcaCoreClient,
  NaviDcaDryRunClient,
  NaviDcaPaginatedCoins
} from './client'
export { getDcaPackageId } from './getDcaPackageId'
export { getDcaConfig } from './getDcaConfig'
export type { DcaConfig } from './getDcaConfig'
export * from './types'
export * from './utils'
export * from './queryOrders'
