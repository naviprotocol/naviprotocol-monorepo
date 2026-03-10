---
name: navi-swap
description: Low-level DEX aggregator SDK for token swapping on Sui blockchain via NAVI Astros. Provides quote fetching, PTB-based swap transaction building, and MEV protection. Supports Cetus, Turbos, DeepBook, Aftermath, Bluefin, Magma, Momentum and more. Use when building custom swap transactions at the PTB level, needing direct control over swap routing and fees, or integrating DEX aggregation without the wallet-client abstraction.
---

# NAVI Astros Aggregator SDK

`@naviprotocol/astros-aggregator-sdk` - DEX aggregator for optimal token swaps on Sui.

```bash
npm install @naviprotocol/astros-aggregator-sdk
```

Supported DEXs: Cetus, Turbos, DeepBook V3, Aftermath, Bluefin, Magma, Momentum, KriyaV2/V3.

## SwapOptions

All swap functions accept optional `SwapOptions`:

```typescript
type SwapOptions = {
  baseUrl?: string
  dexList?: Dex[]          // Filter DEXs for routing
  byAmountIn?: boolean     // Calculate based on input amount (use true)
  depth?: number           // Route calculation depth
  serviceFee?: {
    fee: number            // e.g., 0.01 for 1%
    receiverAddress: string
  }
  slippage?: number        // e.g., 0.01 for 1%, used in swapPTB only
}
```

## Get Quote

```typescript
import { getQuote } from '@naviprotocol/astros-aggregator-sdk'

const quote = await getQuote(
  '0x2::sui::SUI',           // fromCoinAddress
  '0xa99b...::navx::NAVX',   // toCoinAddress
  1_000_000_000,              // amountIn (atomic units)
  'your-api-key',             // optional API key
  swapOptions                 // optional SwapOptions
)
// Returns: { routes, amount_in, amount_out, from, target, dexList, from_token, to_token, is_accurate }
```

## Build Swap PTB from Quote

Build a swap transaction from an existing quote. Returns the output coin object.

```typescript
import { buildSwapPTBFromQuote, getQuote } from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const quote = await getQuote(fromAddr, toAddr, amount)
const coinIn = tx.splitCoins(tx.gas, [amount])

const coinOut = await buildSwapPTBFromQuote(
  userAddress,    // sender address
  tx,             // Transaction
  minAmountOut,   // minimum output (slippage protection)
  coinIn,         // input coin object
  quote,          // quote from getQuote
  referral,       // optional, default 0
  ifPrint,        // optional, default true
  apiKey,         // optional
  swapOptions     // optional
)

tx.transferObjects([coinOut], userAddress)
```

## Swap PTB (without managing quote)

Simplified interface that handles quoting internally:

```typescript
import { swapPTB } from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const coinIn = tx.splitCoins(tx.gas, [amount])

const coinOut = await swapPTB(
  userAddress,      // sender address
  tx,               // Transaction
  fromCoinAddress,  // e.g., '0x2::sui::SUI'
  toCoinAddress,    // target token address
  coinIn,           // input coin object
  amountIn,         // amount in atomic units
  minAmountOut,     // minimum output
  apiKey,           // optional
  swapOptions       // optional
)
```

## MEV Protection

Sign and execute transactions with Shio MEV protection:

```typescript
import { executeTransaction } from '@naviprotocol/astros-aggregator-sdk'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const signer = Ed25519Keypair.fromSecretKey(privateKey)
const result = await executeTransaction(tx, signer)
```

## Complete Example: Swap 1 SUI to NAVX

```typescript
import { getQuote, buildSwapPTBFromQuote, executeTransaction, Dex } from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const signer = Ed25519Keypair.fromSecretKey(privateKey)
const tx = new Transaction()

const quote = await getQuote(
  '0x2::sui::SUI',
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
  1e9,
  'your-api-key',
  { dexList: [Dex.CETUS, Dex.TURBOS], depth: 3 }
)

const coinIn = tx.splitCoins(tx.gas, [1e9])
const coinOut = await buildSwapPTBFromQuote(signer.getPublicKey().toSuiAddress(), tx, minAmountOut, coinIn, quote)
tx.transferObjects([coinOut], signer.getPublicKey().toSuiAddress())

await executeTransaction(tx, signer)
```
