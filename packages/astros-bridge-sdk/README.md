# @naviprotocol/astros-bridge-sdk

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Fastros-bridge-sdk.svg)](https://badge.fury.io/js/%40naviprotocol%2Fastros-bridge-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Astros Bridge SDK is a cross-chain bridge SDK designed for the Sui blockchain. It supports token transfers between different blockchain networks, currently mainly supporting cross-chain operations through bridge providers like Mayan.

## Features

- 🌉 **Cross-chain Bridging**: Supports token transfers between multiple blockchain networks
- 🔄 **Multi-chain Support**: Supports mainstream blockchains like Sui, Ethereum, Solana
- 💰 **Optimal Paths**: Automatically finds the best cross-chain paths
- 🔒 **Secure & Reliable**: Based on mature bridge protocols
- 📊 **Real-time Quotes**: Provides real-time cross-chain swap quotes
- 📱 **Easy Integration**: Clean API design, easy to integrate into various applications

## Supported Blockchains

- Sui
- Ethereum
- Solana
- More chains support coming soon...

## Installation

```bash
npm install @naviprotocol/astros-bridge-sdk
# or
yarn add @naviprotocol/astros-bridge-sdk
# or
pnpm add @naviprotocol/astros-bridge-sdk
```

## Quick Start

### Get Supported Chains

```typescript
import { getSupportChains } from '@naviprotocol/astros-bridge-sdk'

// Get supported blockchain list
const chains = await getSupportChains()
console.log('Supported chains:', chains)
```

### Get Supported Tokens

```typescript
import { getSupportTokens } from '@naviprotocol/astros-bridge-sdk'

// Get supported tokens for a specific blockchain
const tokens = await getSupportTokens(
  1, // Chain ID (1 = Ethereum)
  1, // Page number
  100 // Page size
)
console.log('Supported tokens:', tokens)
```

### Search Tokens

```typescript
import { searchSupportTokens } from '@naviprotocol/astros-bridge-sdk'

// Search for specific tokens
const searchResults = await searchSupportTokens(
  1, // Chain ID
  'USDC' // Search keyword
)
console.log('Search results:', searchResults)
```

### Get Cross-chain Swap Quote

```typescript
import { getQuote } from '@naviprotocol/astros-bridge-sdk'

// Define source and target tokens
const fromToken = {
  address: '0xA0b86a33E6441b8c4C8B8C4C8B8C4C8B8C4C8B8C4C',
  symbol: 'USDC',
  decimals: 6,
  chainId: 1 // Ethereum
}

const toToken = {
  address: '0x2::sui::SUI',
  symbol: 'SUI',
  decimals: 9,
  chainId: 2 // Sui
}

// Get cross-chain swap quote
const quote = await getQuote(
  fromToken,
  toToken,
  '1000000', // 100 USDC (6 decimals)
  {
    slippageBps: 50, // 0.5% slippage
    referrerBps: 10 // 0.1% referrer fee
  }
)

console.log('Cross-chain quote:', quote)
```

### Execute Cross-chain Swap

```typescript
import { swap } from '@naviprotocol/astros-bridge-sdk'

// Execute cross-chain swap
const transaction = await swap(
  quote.routes[0], // Select first quote route
  '0xYourFromAddress', // Source address
  '0xYourToAddress', // Target address
  walletConnection, // Wallet connection
  {
    sui: '0xYourSuiReferrerAddress',
    evm: '0xYourEthereumReferrerAddress',
    solana: 'YourSolanaReferrerAddress'
  }
)

console.log('Transaction details:', transaction)
```

### Query Transaction Status

```typescript
import { getTransaction, getWalletTransactions } from '@naviprotocol/astros-bridge-sdk'

// Query transaction details by hash
const transaction = await getTransaction('0xTransactionHash')
console.log('Transaction details:', transaction)

// Query wallet transaction history
const history = await getWalletTransactions(
  '0xWalletAddress',
  1, // Page number
  10 // Page size
)
console.log('Transaction history:', history)
```

## API Reference

### getSupportChains

Get list of supported blockchains.

```typescript
function getSupportChains(): Promise<Chain[]>
```

**Returns:** List of supported blockchains

### getSupportTokens

Get list of supported tokens for a specific blockchain.

```typescript
function getSupportTokens(
  chainId: number,
  page?: number,
  pageSize?: number
): Promise<Token[]>
```

**Parameters:**
- `chainId`: Blockchain ID
- `page`: Page number (default: 1)
- `pageSize`: Page size (default: 100)

**Returns:** List of supported tokens

### searchSupportTokens

Search for tokens on a specific blockchain.

```typescript
function searchSupportTokens(
  chainId: number,
  keyword: string
): Promise<Token[]>
```

**Parameters:**
- `chainId`: Blockchain ID
- `keyword`: Search keyword

**Returns:** List of matching tokens

### getQuote

Get cross-chain swap quote.

```typescript
function getQuote(
  from: Token,
  to: Token,
  amount: string | number,
  options?: BridgeSwapOptions
): Promise<{routes: BridgeSwapQuote[]}>
```

**Parameters:**
- `from`: Source token information
- `to`: Target token information
- `amount`: Swap amount
- `options`: Swap options (slippage, referrer fees)

**Returns:** Available swap routes

### swap

Execute cross-chain swap.

```typescript
function swap(
  quote: BridgeSwapQuote,
  fromAddress: string,
  toAddress: string,
  walletConnection: WalletConnection,
  referrerAddresses?: {
    sui?: string
    evm?: string
    solana?: string
  }
): Promise<BridgeSwapTransaction>
```

**Parameters:**
- `quote`: Swap quote
- `fromAddress`: Source wallet address
- `toAddress`: Target wallet address
- `walletConnection`: Wallet connection
- `referrerAddresses`: Referrer addresses (optional)

**Returns:** Transaction details

### getTransaction

Query transaction details by transaction hash.

```typescript
function getTransaction(hash: string): Promise<BridgeSwapTransaction>
```

**Parameters:**
- `hash`: Transaction hash

**Returns:** Transaction details

### getWalletTransactions

Query wallet transaction history.

```typescript
function getWalletTransactions(
  address: string,
  page?: number,
  limit?: number
): Promise<{transactions: BridgeSwapTransaction[]}>
```

**Parameters:**
- `address`: Wallet address
- `page`: Page number (default: 1)
- `limit`: Page size (default: 10)

**Returns:** Transaction history

## Type Definitions

### Chain

```typescript
interface Chain {
  id: number
  name: string
  // Other chain information
}
```

### Token

```typescript
interface Token {
  address: string
  symbol: string
  decimals: number
  chainId: number
  // Other token information
}
```

### BridgeSwapOptions

```typescript
interface BridgeSwapOptions {
  slippageBps?: number
  referrerBps?: number
}
```

### BridgeSwapQuote

```typescript
interface BridgeSwapQuote {
  from_token: Token
  to_token: Token
  // Other quote information
}
```

### BridgeSwapTransaction

```typescript
interface BridgeSwapTransaction {
  id: string
  status: string
  lastUpdateAt: string
  // Other transaction information
}
```

## Development

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Code Quality

```bash
pnpm lint
pnpm prettier
```

## License

MIT License - see [LICENSE](../../LICENSE) file for details

## Support

- Documentation: [https://navprotocol.io](https://navprotocol.io)
- Issues: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
- Community: [Discord](https://discord.gg/naviprotocol)

## Contributing

We welcome community contributions! Please check our [Contributing Guide](../../CONTRIBUTING.md) to learn how to participate in project development. 