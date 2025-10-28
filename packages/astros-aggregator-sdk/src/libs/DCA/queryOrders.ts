/**
 * DCA Order Query Functions
 *
 * These functions call the Astros backend API to query DCA order information
 */

import axios from 'axios'
import { AggregatorConfig } from '../Aggregator/config'

// Use existing DcaOrderStatus from types
export type DcaOrderStatusFilter = 'active' | 'completed' | 'canceled'

export type DcaOrderSummary = {
  id: string
  status: string
  orderNum: number
  user?: string
  receiptId: string | null
  fromCoinType: string
  fromCoinSymbol: string
  fromCoinLogoURI: string
  toCoinType: string
  toCoinSymbol: string
  toCoinLogoURI: string
  minAmountOut: string
  maxAmountOut: string
  depositedAmount: string
  originalAmountPerCycle: string
  createdAt: string | Date
  updatedAt: string | Date
  gap: {
    value: number
    unit: 'minute' | 'hour' | 'day' | 'week' | 'month'
  }
  cliff: {
    value: number
    unit: 'minute' | 'hour' | 'day' | 'week' | 'month'
  }
  createTxDigest: string | null
  cancelTxDigest: string | null
  priceOutPerIn: { min: number | null; max: number | null }
  priceInPerOut: { min: number | null; max: number | null }
  progress: {
    succeededInput: string
    depositedInput: string
    percentage: number
  }
}

export type DcaOrderExecution = {
  cycleNumber: number
  createdAt: string | Date
  status: string
  amountIn: string
  amountOut: string
  protocolFeeCharged: string
  priceOutPerIn: number | null
  priceInPerOut: number | null
  txDigest: string | null
}

export type DcaOrderDetails = DcaOrderSummary & {
  currentCycle: number
  totalSucceeded: number
  lastExecutionStatus: string | null
  fills: DcaOrderExecution[]
}

export type UserOrdersResponse = {
  data: DcaOrderSummary[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/**
 * Get DCA orders for a specific user with pagination
 *
 * @param userAddress - Sui address of the user
 * @param options - Query options
 * @returns User orders with pagination info
 */
export async function getUserDcaOrders(
  userAddress: string,
  options?: {
    page?: number
    pageSize?: number
    status?: DcaOrderStatusFilter
  }
): Promise<UserOrdersResponse> {
  const baseUrl = AggregatorConfig.aggregatorBaseUrl.replace('/find_routes', '')

  const params = new URLSearchParams()
  if (options?.page !== undefined) params.append('page', String(options.page))
  if (options?.pageSize !== undefined) params.append('pageSize', String(options.pageSize))
  if (options?.status) params.append('status', options.status)

  const url = `${baseUrl}/dca/users/${userAddress}/orders?${params.toString()}`

  const response = await axios.get(url)
  return response.data
}

/**
 * Get detailed information about a specific DCA order
 *
 * @param orderId - The DCA order ID
 * @returns Order details with execution history
 */
export async function getDcaOrderDetails(orderId: string): Promise<DcaOrderDetails> {
  const baseUrl = AggregatorConfig.aggregatorBaseUrl.replace('/find_routes', '')

  const url = `${baseUrl}/dca/orders/${orderId}`

  const response = await axios.get(url)
  return response.data
}

/**
 * List all DCA orders grouped by status
 *
 * @param options - Query options
 * @returns Orders grouped by status or filtered list
 */
export async function listDcaOrders(options?: {
  status?: DcaOrderStatusFilter
  creator?: string
}): Promise<
  | DcaOrderSummary[]
  | { active: DcaOrderSummary[]; completed: DcaOrderSummary[]; canceled: DcaOrderSummary[] }
> {
  const baseUrl = AggregatorConfig.aggregatorBaseUrl.replace('/find_routes', '')

  const params = new URLSearchParams()
  if (options?.status) params.append('status', options.status)
  if (options?.creator) params.append('creator', options.creator)

  const url = `${baseUrl}/dca/orders?${params.toString()}`

  const response = await axios.get(url)
  return response.data
}
