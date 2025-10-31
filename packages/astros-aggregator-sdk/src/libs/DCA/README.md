# DCA Module

Dollar-Cost Averaging (DCA) SDK for Astros Aggregator

## Features

- ✅ Create DCA orders
- ✅ Cancel DCA orders
- ✅ Query user orders with pagination
- ✅ Get order details with execution history
- ✅ List all orders by status

## Usage

### 1. Create DCA Order

```typescript
import { createDcaOrder, TimeUnit } from '@naviprotocol/astros-aggregator-sdk'

<<<<<<< HEAD
<<<<<<< HEAD
// SDK automatically handles coin selection, merging, and balance checks
const tx = await createDcaOrder(
  client,
  userAddress, // User's wallet address
=======
// Use default production config
const tx = await createDcaOrder(
  client,
>>>>>>> a3e7397 (create dcaOption)
=======
// SDK automatically handles coin selection, merging, and balance checks
const tx = await createDcaOrder(
  client,
  userAddress, // User's wallet address
>>>>>>> 4275cb8 (fix few bugs)
  {
    fromCoinType: '0x2::sui::SUI',
    toCoinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    depositedAmount: '1500000000', // 1.5 SUI in atomic units (1.5 * 10^9)
    totalExecutions: 10,
    frequency: {
      value: 1,
      unit: TimeUnit.HOUR
    },
    priceRange: {
      min: '900000000', // Min price in atomic units
      max: '1100000000'  // Max price in atomic units
    }
  }
<<<<<<< HEAD
)

// Override for testing environment
const testTx = await createDcaOrder(
  client,
  userAddress,
  params,
  {
    dcaContract: '0xTEST_PACKAGE_ID',
    dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
    dcaRegistry: '0xTEST_REGISTRY'
  }
=======
>>>>>>> 4275cb8 (fix few bugs)
)

// Override for testing environment
const testTx = await createDcaOrder(
  client,
  userAddress,
  params,
  {
    dcaContract: '0xTEST_PACKAGE_ID',
    dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
    dcaRegistry: '0xTEST_REGISTRY'
  }
)
```

**Note:** All amount fields must be in atomic units. For example:
- 1 SUI = 1000000000 (1 * 10^9)
- 1 USDC = 1000000 (1 * 10^6)

The SDK automatically:
- ✅ Fetches all coins of the specified type
- ✅ Merges multiple coins if needed
- ✅ Checks if balance is sufficient
- ✅ Handles SUI gas coin properly

### 2. Query User Orders

```typescript
import { getUserDcaOrders } from '@naviprotocol/astros-aggregator-sdk'

// Get all active orders for a user
const result = await getUserDcaOrders('0xUSER_ADDRESS', {
  status: 'active', // 'active' | 'completed' | 'canceled'
  page: 0,
  pageSize: 10
})

console.log('Orders:', result.data)
console.log('Total:', result.pagination.total)
```

### 3. Get Order Details

```typescript
import { getDcaOrderDetails } from '@naviprotocol/astros-aggregator-sdk'

const order = await getDcaOrderDetails('ORDER_ID')

console.log('Order status:', order.status)
console.log('From:', order.fromCoinSymbol, order.fromCoinLogoURI)
console.log('To:', order.toCoinSymbol, order.toCoinLogoURI)
console.log('Progress:', order.progress.percentage * 100, '%')
console.log('Executions:', order.fills.length)

// Show execution history
order.fills.forEach((fill, i) => {
  console.log(`Cycle ${fill.cycleNumber}:`, {
    amountIn: fill.amountIn,
    amountOut: fill.amountOut,
    price: fill.priceOutPerIn,
    status: fill.status,
    txDigest: fill.txDigest
  })
})
```

### 4. List All Orders by Status

```typescript
import { listDcaOrders } from '@naviprotocol/astros-aggregator-sdk'

// Get orders grouped by status
const orders = await listDcaOrders()
console.log('Active:', orders.active.length)
console.log('Completed:', orders.completed.length)
console.log('Canceled:', orders.canceled.length)

// Or filter by specific status
const activeOrders = await listDcaOrders({ status: 'active' })
```

### 5. Cancel DCA Order

```typescript
import { cancelDcaOrder, getUserDcaOrders } from '@naviprotocol/astros-aggregator-sdk'

// First, get the order with receiptId from backend API
const orders = await getUserDcaOrders(userAddress, { status: 'active' })

// Check if receiptId is available
const order = orders.data[0]
if (!order.receiptId) {
  throw new Error(
    'Receipt ID not available. Order may have been created before this feature was added.'
  )
}

// Use default production config
const tx = await cancelDcaOrder(
  {
    fromCoinType: order.fromCoinType,
    toCoinType: order.toCoinType
  },
  order.receiptId, // Receipt ID from backend API
  userAddress
)

// Override for testing environment
const testTx = await cancelDcaOrder(
  {
    fromCoinType: order.fromCoinType,
    toCoinType: order.toCoinType
  },
  order.receiptId,
  userAddress,
  {
    dcaContract: '0xTEST_PACKAGE_ID',
    dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
    dcaRegistry: '0xTEST_REGISTRY'
  }
)

// Sign and execute
const result = await suiClient.signAndExecuteTransaction({
  transaction: tx,
  signer: keypair
})
```

**Important Notes**:

- The `receiptId` is provided by the backend API in all order query responses
- No additional blockchain queries are needed
- If `receiptId` is `null`, the order was created before this feature was implemented

## Configuration

### DCA Options (Testing)

The SDK uses production contract addresses by default. You can override them for testing using the optional `dcaOptions` parameter:

```typescript
import { DcaOptions } from '@naviprotocol/astros-aggregator-sdk'

// Test contract configuration
const testOptions: DcaOptions = {
  dcaContract: '0xTEST_PACKAGE_ID',
  dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
  dcaRegistry: '0xTEST_REGISTRY'
}

// Apply to all DCA operations
const tx1 = await createDcaOrder(client, params, coinId, address, testOptions)
const tx2 = await cancelDcaOrder(params, receiptId, address, testOptions)
```

**Production vs Testing**:

| Environment | Configuration                        |
| ----------- | ------------------------------------ |
| Production  | No `dcaOptions` parameter (default)  |
| Testing     | Pass `dcaOptions` with test contract |

**Available in**:

- ✅ `createDcaOrder()`
- ✅ `cancelDcaOrder()`

**Note**: Query functions (`getUserDcaOrders`, `getDcaOrderDetails`, etc.) use the backend API, which is configured separately via `updateConfig({ aggregatorBaseUrl })` in the Aggregator module.

## Understanding Order ID vs Receipt ID

When you create a DCA order, two objects are created on-chain:

1. **Order** (stored in OrderRegistry)

   - Contains all order data (amounts, schedule, status, etc.)
   - Anyone can read the order status
   - `id` field = Order ID (e.g., `0x2440d6...`)

2. **Receipt** (owned by the user)
   - Proof of ownership for the order
   - Required to cancel the order
   - `receiptId` field = Receipt Object ID (e.g., `0x6f528e...`)
   - Contains `order_id` field pointing to the Order

**Why two IDs?**

- The Receipt is your **ownership proof** - only the Receipt holder can cancel the order
- This follows Sui's object ownership model for security
- The backend automatically extracts and stores both IDs for your convenience

## Types

### Order Response

All order queries return orders with the following structure:

```typescript
{
  id: string                            // Order ID (on-chain order object)
  status: 'active' | 'completed' | 'canceled'
  orderNum: number
  user: string
  receiptId: string | null              // Receipt object ID (required for cancellation)
                                        // null for orders created before this feature

  // Coin information with metadata
  fromCoinType: string
  fromCoinSymbol: string      // e.g., "SUI"
  fromCoinLogoURI: string     // Token icon URL
  toCoinType: string
  toCoinSymbol: string        // e.g., "NAVX"
  toCoinLogoURI: string       // Token icon URL

  // Amounts
  depositedAmount: string
  originalAmountPerCycle: string
  minAmountOut: string
  maxAmountOut: string

  // Schedule
  gap: { value: number, unit: 'minute' | 'hour' | 'day' | 'week' | 'month' }
  cliff: { value: number, unit: 'minute' | 'hour' | 'day' | 'week' | 'month' }

  // Progress
  progress: {
    succeededInput: string
    depositedInput: string
    percentage: number        // 0.0 to 1.0
  }

  // Price ranges
  priceOutPerIn: { min: number | null, max: number | null }
  priceInPerOut: { min: number | null, max: number | null }

  // Timestamps
  createdAt: string
  updatedAt: string
  createTxDigest: string | null
  cancelTxDigest: string | null
}
```

### Order Details

When calling `getDcaOrderDetails()`, you also get execution history and additional fields:

```typescript
{
  ...orderFields,

  // Additional execution info
  currentCycle: number             // Current cycle number
  totalSucceeded: number           // Total successful executions
  lastExecutionStatus: string | null  // Status of last execution

  // Execution history
  fills: [
    {
      cycleNumber: number
      createdAt: string
      status: string
      amountIn: string
      amountOut: string
      protocolFeeCharged: string
      priceOutPerIn: number | null
      priceInPerOut: number | null
      txDigest: string | null
    }
  ]
}
```

## Configuration

The SDK uses the default Astros aggregator API endpoint. If you need to customize it:

```typescript
import { updateConfig } from '@naviprotocol/astros-aggregator-sdk'

// Optional: customize the aggregator endpoint
updateConfig({
  aggregatorBaseUrl: 'https://open-aggregator-api.naviprotocol.io/find_routes'
})
```

**Note**: DCA query functions automatically derive the API base URL from the aggregator configuration.
