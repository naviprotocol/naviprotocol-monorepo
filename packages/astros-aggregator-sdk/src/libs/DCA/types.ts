/**
 * DCA Types
 *
 * Type definitions for DCA order management and execution
 */

/**
 * OrderRegistry structure from Move contract
 */
export type OrderRegistry = {
  userOrders: Record<string, string[]> // user_addr -> vector<order_addr>
  orders: Record<string, DcaOrderMetadata> // order_addr -> order (raw on-chain format)
  batchOrders: Record<string, string[]> // batch_id -> vector<order_addr>
  nextBatchId: number
}

/**
 * DCA order creation parameters
 */
export type DcaOrderParams = {
  fromCoinType: string // Input token type
  toCoinType: string // Output token type
  depositedAmount: string // Total deposit amount for all executions
  orderNum: number // Number of execution cycles
  gapDurationMs: number // Fixed time gap between investments
  executionWindowMs: number // Time window for each execution
  cliffDurationMs: number // Delay before first execution
  feeRate: number // Fee rate (per million)
  minAmountOut: string // Min price protection
  maxAmountOut: string // Max price protection
}

/**
 * DCA order metadata
 */
export type DcaOrderMetadata = {
  orderId: string // Order unique identifier
  user: string // Order owner address
  batchId?: number // Optional batch ID for grouped orders
  gapDurationMs: number // Fixed time gap between investments in milliseconds
  orderNum: number // Total number of execution cycles planned
  executionWindowMs: number // Time window for each execution in milliseconds
  cliffDurationMs: number // Delay before first execution in milliseconds
  minAmountOut: string // Minimum output amount per execution (price protection)
  maxAmountOut: string // Maximum output amount per execution (price protection)
  fromCoinType: string // Input token type (user trades from this coin)
  toCoinType: string // Output token type (user trades to this coin)
  depositedAmount: string // Total amount originally deposited by user
  paidFee: string // Total protocol fee paid so far
  feeRate: number // Fee rate for this order (per million)
  fulfilledTimes: number[] // Timestamps of successful executions
  nextExecutionTime: number // Next scheduled execution time in milliseconds
  currentCycle: number // Current execution cycle number (0-based)
  createdAt: number // Order creation timestamp in milliseconds
  inBalance: string // Remaining input token balance
  outBalance: string // Accumulated output token balance available for withdrawal
  outWithdrawn: string // Total output tokens withdrawn by user so far
  status: DcaOrderStatus // Order status
}

/**
 * DCA order status enumeration
 */
export enum DcaOrderStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

/**
 * DCA order query parameters
 */
export type DcaOrderQuery = {
  creator?: string
  status?: DcaOrderStatus[]
  fromCoinType?: string
  toCoinType?: string
  limit?: number
  offset?: number
}

/**
 * DCA order cancellation parameters
 */
export type CancelDcaOrderParams = {
  fromCoinType: string
  toCoinType: string
}

/**
 * Order Created Event
 */
export type OrderCreatedEvent = {
  recipeId: string // Order ID
  batchId?: number // Batch ID for grouped orders
  gapDurationMs: number // Fixed time gap between investments
  orderNum: number // How many times to invest
  executionWindowMs: number // Time window for each execution
  cliffDurationMs: number // Delay before first execution
  minAmountOut: string // Min price protection
  maxAmountOut: string // Max price protection
  feeRate: number // Fee rate for this order (per million)
  fromCoinType: string // Input token type
  toCoinType: string // Output token type
  depositedAmount: string // Total deposited amount
  createdTime: number // Creation timestamp
}

/**
 * Batch Created Event
 */
export type BatchCreatedEvent = {
  batchId: number // Batch ID
  user: string // Batch creator
  orderCount: number // Number of orders in batch
  totalDeposited: string // Total amount deposited across all orders
  createdTime: number // Batch creation timestamp
}

/**
 * Order Filled Event
 */
export type OrderFilledEvent = {
  recipeId: string // Order ID
  amountIn: string // Input amount used (before fee)
  amountOut: string // Output amount received
  fromCoinType: string // Input token type
  toCoinType: string // Output token type
  protocolFeeCharged: string // Protocol fee charged
  fulfilledTime: number // Execution timestamp
}

/**
 * Order Finished Event
 */
export type OrderFinishedEvent = {
  recipeId: string // Order ID
  amountInReturned: string // Input amount returned to user
  amountOutReturned: string // Output amount returned to user
  fromCoinType: string // Input token type
  toCoinType: string // Output token type
  isEarlyTerminated: boolean // Whether cancelled early
}

/**
 * Withdraw Event
 */
export type WithdrawEvent = {
  recipeId: string // Order ID
  user: string // User address
  tokenType: string // Output token type
  amount: string // Amount withdrawn
  withdrawnAt: number // Withdrawal timestamp
}

/**
 * Protocol Fee Collected Event
 */
export type ProtocolFeeCollectedEvent = {
  tokenType: string // Fee token type
  amount: string // Fee amount collected
  collectedAt: number // Collection timestamp
}

/**
 * Protocol Fee Claimed Event
 */
export type ProtocolFeeClaimedEvent = {
  tokenType: string // Fee token type
  amount: string // Fee amount claimed
  recipient: string // Fee recipient
  claimedAt: number // Claim timestamp
}
