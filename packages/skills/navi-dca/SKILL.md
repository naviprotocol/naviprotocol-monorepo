---
name: navi-dca
description: DCA (Dollar-Cost Averaging) SDK for creating and managing automated periodic token purchase orders on Sui blockchain via NAVI Astros. Use when setting up recurring token purchases, creating DCA strategies, canceling DCA orders, or querying DCA order status and execution history.
---

# NAVI Astros DCA SDK

`@naviprotocol/astros-dca-sdk` - Automated dollar-cost averaging on Sui.

```bash
npm install @naviprotocol/astros-dca-sdk
```

## Key Types

```typescript
import { TimeUnit, DcaOrderParams, DcaOrderStatus } from '@naviprotocol/astros-dca-sdk'

enum TimeUnit { MINUTE = 'minute', HOUR = 'hour', DAY = 'day', WEEK = 'week', MONTH = 'month' }
enum DcaOrderStatus { ACTIVE = 'active', COMPLETED = 'completed', CANCELED = 'canceled' }

type DcaOrderParams = {
  fromCoinType: string           // Input token type (e.g., '0x2::sui::SUI')
  toCoinType: string             // Output token type
  depositedAmount: string | number | bigint  // Total deposit in atomic units
  frequency: { value: number, unit: TimeUnit }  // Execution interval
  totalExecutions: number        // Number of executions
  startTime?: number             // Start timestamp in ms (optional)
  priceRange?: {                 // Slippage protection (optional)
    minBuyPrice: number | null   // Min price (atomic fromCoin per 1 whole toCoin)
    maxBuyPrice: number | null   // Max price
  }
}
```

## Create DCA Order

All amounts must be in atomic units.

```typescript
import { createDcaOrder, TimeUnit } from '@naviprotocol/astros-dca-sdk'
import { SuiClient } from '@mysten/sui/client'

const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io' })

const tx = await createDcaOrder(client, userAddress, {
  fromCoinType: '0x2::sui::SUI',
  toCoinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
  depositedAmount: '10000000000',  // 10 SUI
  frequency: { value: 1, unit: TimeUnit.DAY },
  totalExecutions: 10,
  priceRange: { minBuyPrice: 40000000, maxBuyPrice: 50000000 }
})

// Sign and execute the returned transaction
```

## Cancel DCA Order

```typescript
import { cancelDcaOrder, getUserDcaOrders } from '@naviprotocol/astros-dca-sdk'

const orders = await getUserDcaOrders(userAddress, { status: 'active' })
const order = orders.data[0]

const tx = await cancelDcaOrder(
  { fromCoinType: order.fromCoinType, toCoinType: order.toCoinType },
  order.receiptId,   // receipt object ID from API
  userAddress
)

// Sign and execute the returned transaction
```

## Query Orders

### Get User Orders

```typescript
import { getUserDcaOrders } from '@naviprotocol/astros-dca-sdk'

const result = await getUserDcaOrders(userAddress, {
  page: 1,
  pageSize: 10,
  status: 'active'  // 'active' | 'completed' | 'canceled'
})
// result: { data: DcaOrderSummary[], pagination: { page, pageSize, total, totalPages } }
```

### Get Order Details

```typescript
import { getDcaOrderDetails } from '@naviprotocol/astros-dca-sdk'

const details = await getDcaOrderDetails(orderId)
// Includes: currentCycle, totalSucceeded, fills (execution history), progress
```

### List All Orders

```typescript
import { listDcaOrders } from '@naviprotocol/astros-dca-sdk'

const orders = await listDcaOrders({
  status: 'active',
  creator: userAddress
})
```

## DcaOptions (contract overrides, for testing)

```typescript
type DcaOptions = {
  dcaContract?: string
  dcaGlobalConfig?: string
  dcaRegistry?: string
}
```
