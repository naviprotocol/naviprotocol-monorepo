# Swap Module

## Configuration

```typescript
const walletClient = new WalletClient({
  configs: {
    swap: {
      apiKey: 'your-api-key',
      serviceFee: {
        recipient: '0x...',
        fee: 0.001  // 0.1%
      }
    }
  }
})
```

## swap

Execute a token swap with automatic quote fetching and transaction building.

```typescript
const result = await walletClient.swap.swap(
  '0x2::sui::SUI',                    // fromCoinType
  '0x5d4b...::coin::COIN',            // toCoinType
  1_000_000_000,                       // amount in atomic units
  0.01,                                // slippage tolerance (1%)
  { dryRun: false }
)
```

## getQuote

Get a swap quote without executing.

```typescript
const quote = await walletClient.swap.getQuote(
  '0x2::sui::SUI',
  '0x5d4b...::coin::COIN',
  1_000_000_000,
  swapOptions
)
```

## buildSwapPTBFromQuote

Build a swap PTB from an existing quote for custom transaction composition.

```typescript
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const coinIn = tx.splitCoins(tx.gas, [1_000_000_000])

const coinOut = await walletClient.swap.buildSwapPTBFromQuote(
  tx,
  minAmountOut,
  coinIn,
  quote,
  swapOptions
)

tx.transferObjects([coinOut], walletClient.address)
await walletClient.signExecuteTransaction({ transaction: tx })
```

## SwapOptions

```typescript
type SwapOptions = {
  baseUrl?: string
  dexList?: Dex[]
  byAmountIn?: boolean
  depth?: number
  serviceFee?: { fee: number; receiverAddress: string }
  slippage?: number  // only used in swapPTB, not getQuote
}
```

## Events

```typescript
walletClient.events.on('swap:swap-success', (data) => { /* swap completed */ })
```
