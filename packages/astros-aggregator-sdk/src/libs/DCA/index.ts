/**
 * DCA (Dollar-Cost Averaging) Module
 *
 * This module provides SDK functions for creating and managing DCA orders
 * using Astros aggregator's routing capabilities.
 */

export { createDcaOrder } from './createDcaOrder'
export { cancelDcaOrder } from './cancelDcaOrder'
export { claimDcaOrder } from './claimDcaOrder'
export { withdrawOutput, withdrawOutputAmount } from './withdrawOutput'
export { queryDcaOrders } from './queryDcaOrders'

export * from './types'
