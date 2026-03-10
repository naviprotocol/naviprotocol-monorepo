---
name: navi-bridge
description: Cross-chain bridge SDK for token transfers between Sui and other blockchains (Ethereum, Solana, Polygon, Avalanche, Arbitrum) via NAVI Astros Bridge. Uses Mayan bridge provider. Use when performing cross-chain token transfers, bridging assets to/from Sui, or querying bridge transaction status.
---

# NAVI Astros Bridge SDK

`@naviprotocol/astros-bridge-sdk` - Cross-chain bridging for Sui.

```bash
npm install @naviprotocol/astros-bridge-sdk
```

Supported chains: Sui, Solana, Ethereum, Polygon, Avalanche, Arbitrum.

## Setup

```typescript
import { config } from '@naviprotocol/astros-bridge-sdk'

config({ apiKey: 'your-api-key' })
```

## Query Supported Chains

```typescript
import { getSupportChains } from '@naviprotocol/astros-bridge-sdk'

const chains = await getSupportChains()
const suiChain = chains[6]
const solanaChain = chains[0]
```

## Search Bridge Tokens

```typescript
import { searchSupportTokens } from '@naviprotocol/astros-bridge-sdk'

const navxResult = await searchSupportTokens(
  suiChain.id,
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'
)
const suiNavx = navxResult[0]

const usdcResult = await searchSupportTokens(
  solanaChain.id,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
)
const solanaUsdc = usdcResult[0]
```

## Get Quote

```typescript
import { getQuote } from '@naviprotocol/astros-bridge-sdk'

const quotes = await getQuote(suiNavx, solanaUsdc, 10, {
  slippageBps: 50  // 0.5% slippage
})
```

## Execute Bridge Swap

```typescript
import { swap } from '@naviprotocol/astros-bridge-sdk'

const transaction = await swap(
  quotes.routes[0],   // selected route
  fromAddress,         // sender address
  toAddress,           // recipient address on target chain
  walletConnect        // wallet connection adapter
)
```

## Query Transaction Status

```typescript
import { getTransaction } from '@naviprotocol/astros-bridge-sdk'

const tx = await getTransaction(transaction.id)
switch (tx.status) {
  case 'processing': break
  case 'completed': break
  case 'fail': break
}
```

## Query Wallet Transaction History

```typescript
import { getWalletTransactions } from '@naviprotocol/astros-bridge-sdk'

const history = await getWalletTransactions(address, page, limit)
```
