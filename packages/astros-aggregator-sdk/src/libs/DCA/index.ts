/**
 * DCA (Dollar-Cost Averaging) Module
 *
 * This module provides SDK functions for creating and managing DCA orders
 * using Astros aggregator's routing capabilities.
 */

export { createDcaOrder } from './createDcaOrder'
<<<<<<< HEAD
export { getCoinForDca } from './coinUtils'
=======
export { getCoinForDca, getCoins, returnMergedCoins } from './coinUtils'
>>>>>>> 4275cb8 (fix few bugs)
export { cancelDcaOrder } from './cancelDcaOrder'
export { getDcaPackageId } from './getDcaPackageId'
export { getDcaConfig } from './getDcaConfig'
export type { DcaConfig } from './getDcaConfig'
export * from './types'
export * from './utils'
export * from './queryOrders'
