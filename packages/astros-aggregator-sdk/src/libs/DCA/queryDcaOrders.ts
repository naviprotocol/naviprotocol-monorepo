/**
 * Query DCA Orders Functions
 *
 * Retrieves DCA order information from OrderRegistry
 */

import { SuiClient } from '@mysten/sui/client'
import { DcaOrderMetadata, DcaOrderQuery, OrderRegistry } from './types'
import { AggregatorConfig } from '../Aggregator'

/**
 * Queries DCA orders from OrderRegistry
 *
 * @param query - Query parameters to filter orders
 * @param client - Sui client instance
 * @returns Promise<DcaOrderMetadata[]> - Array of DCA order metadata
 */
export async function queryDcaOrders(
  query: DcaOrderQuery,
  client: SuiClient
): Promise<DcaOrderMetadata[]> {
  try {
    if (!AggregatorConfig.dcaRegistry) {
      throw new Error('DCA Registry address not configured')
    }

    // Get the OrderRegistry object
    const registryResponse = await client.getObject({
      id: AggregatorConfig.dcaRegistry,
      options: {
        showContent: true,
        showType: true
      }
    })

    if (
      !registryResponse.data?.content ||
      registryResponse.data.content.dataType !== 'moveObject'
    ) {
      throw new Error('Failed to fetch OrderRegistry')
    }

    const registry = registryResponse.data.content.fields as OrderRegistry

    let orderAddresses: string[] = []

    // Determine which orders to fetch based on query
    if (query.creator) {
      const userOrders = registry.userOrders[query.creator]
      if (userOrders) {
        orderAddresses = userOrders
      }
    } else {
      orderAddresses = Object.keys(registry.orders)
    }

    // Convert orders to metadata format
    const orders: DcaOrderMetadata[] = []

    for (const orderAddr of orderAddresses) {
      const order = registry.orders[orderAddr]
      if (!order) continue

      // Apply filters
      if (query.fromCoinType && order.fromCoinType !== query.fromCoinType) continue
      if (query.toCoinType && order.toCoinType !== query.toCoinType) continue

      // Apply status filter
      if (query.status && query.status.length > 0 && !query.status.includes(order.status)) {
        continue
      }

      // Calculate paid fee from fulfilled times and fee rate
      const paidFee =
        order.fulfilledTimes.length > 0
          ? (
              (BigInt(order.depositedAmount) *
                BigInt(order.feeRate) *
                BigInt(order.fulfilledTimes.length)) /
              (BigInt(1000000) * BigInt(order.orderNum))
            ).toString()
          : '0'

      orders.push(order)
    }

    // Sort by creation time (most recent first)
    orders.sort((a, b) => b.createdAt - a.createdAt)

    // Apply pagination
    const offset = query.offset || 0
    const limit = query.limit || 50
    return orders.slice(offset, offset + limit)
  } catch (error) {
    console.error('Error querying DCA orders:', error)
    throw new Error(`Failed to query DCA orders: ${error}`)
  }
}
