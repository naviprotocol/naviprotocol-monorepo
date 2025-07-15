# @naviprotocol/astros-aggregator-sdk

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Fastros-aggregator-sdk.svg)](https://badge.fury.io/js/%40naviprotocol%2Fastros-aggregator-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Astros Aggregator SDK is a decentralized exchange (DEX) aggregator SDK designed for the Sui blockchain. It aggregates liquidity from multiple decentralized exchanges to provide users with the best token swap rates.

## Features

- 🔄 **Multi-DEX Aggregation**: Aggregates liquidity from multiple decentralized exchanges
- 💰 **Optimal Quotes**: Automatically finds the best swap paths and prices
- 🚀 **High Performance**: Optimized algorithms ensure fast response times
- 🔒 **Secure & Reliable**: Secure transactions based on the Sui blockchain
- 📱 **Easy Integration**: Clean API design, easy to integrate into various applications

## Supported DEXs

- Aftermath
- Bluefin
- Cetus
- DeepBook
- HaSui
- Kriya V2/V3
- Magma
- Momentum
- Turbos
- vSui

## Installation

```bash
npm install @naviprotocol/astros-aggregator-sdk
# or
yarn add @naviprotocol/astros-aggregator-sdk
# or
pnpm add @naviprotocol/astros-aggregator-sdk
```

## Quick Start

### Get Swap Quote

```typescript
import { getQuote } from '@naviprotocol/astros-aggregator-sdk'

// Get token swap quote
const quote = await getQuote(
  '0x2::sui::SUI', // Source token address
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // Target token address
  '1000000000', // Swap amount (in smallest units)
  'your-api-key', // API key (optional)
  {
    baseUrl: 'https://api.navprotocol.io',
    dexList: [], // Empty array means use all supported DEXs
    byAmountIn: true,
    depth: 3
  }
)

console.log('Swap quote:', quote)
```

### Execute Transaction

```typescript
import { SignAndSubmitTXB } from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'

// Create transaction block
const txb = new Transaction()

// Add swap transaction to the block
// ... add specific transaction operations

// Sign and submit transaction
const result = await SignAndSubmitTXB(txb, client, keypair)
console.log('Transaction result:', result)
```

## API Reference

### getQuote

Get token swap quote.

```typescript
function getQuote(
  fromCoinAddress: string,
  toCoinAddress: string,
  amountIn: number | string | bigint,
  apiKey?: string,
  swapOptions?: SwapOptions
): Promise<Quote>
```

**Parameters:**
- `fromCoinAddress`: Source token address
- `toCoinAddress`: Target token address
- `amountIn`: Swap amount
- `apiKey`: API key (optional)
- `swapOptions`: Swap options (optional)

**Returns:** Quote object containing swap routes and prices

### SignAndSubmitTXB

Sign and submit transaction block.

```typescript
function SignAndSubmitTXB(
  txb: Transaction,
  client: any,
  keypair: any
): Promise<any>
```

**Parameters:**
- `txb`: Sui transaction block
- `client`: Sui client instance
- `keypair`: Keypair for signing

**Returns:** Transaction execution result

## Type Definitions

### SwapOptions

```typescript
interface SwapOptions {
  baseUrl?: string
  dexList: string[]
  byAmountIn: boolean
  depth: number
}
```

### Quote

```typescript
interface Quote {
  // Quote details
  routes: Route[]
  // Other quote information
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