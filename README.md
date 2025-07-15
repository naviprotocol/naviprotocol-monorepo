# NAVI Protocol TypeScript SDK

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Fastros-aggregator-sdk.svg)](https://badge.fury.io/js/%40naviprotocol%2Fastros-aggregator-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/naviprotocol/naviprotocol-monorepo/actions/workflows/ci.yml/badge.svg)](https://github.com/naviprotocol/naviprotocol-monorepo/actions/workflows/ci.yml)

NAVI Protocol TypeScript SDK is a comprehensive DeFi SDK collection designed for the Sui blockchain. It provides complete decentralized finance functionality including token swapping, cross-chain bridging, lending, flash loans, and more.

## 📦 Included Packages

### [@naviprotocol/astros-aggregator-sdk](./packages/astros-aggregator-sdk/)
DEX Aggregator SDK that aggregates liquidity from multiple decentralized exchanges to provide users with the best token swap rates.

**Key Features:**
- 🔄 Multi-DEX Aggregation (Aftermath, Bluefin, Cetus, DeepBook, etc.)
- 💰 Optimal Quote Algorithm
- 🚀 High-Performance Transaction Execution

### [@naviprotocol/astros-bridge-sdk](./packages/astros-bridge-sdk/)
Cross-chain Bridge SDK that supports token transfers between different blockchain networks.

**Key Features:**
- 🌉 Cross-chain Bridging (Sui, Ethereum, Solana)
- 💰 Optimal Path Selection
- 📊 Real-time Quote System

### [@naviprotocol/lending](./packages/lending/)
Lending SDK that provides complete lending functionality.

**Key Features:**
- 💰 Deposit, Borrow, Repay
- ⚡ Flash Loans
- 📊 Price Oracle Integration
- 🏆 Reward System

### [@naviprotocol/wallet-client](./packages/wallet-client/)
Comprehensive Wallet Client SDK that provides a unified interface for DeFi operations.

**Key Features:**
- 🔐 Transaction Signing and Execution
- 💰 Token Swapping
- 🏦 Lending Operations
- 💳 Balance Management
- 🔄 Modular Design

## 🚀 Quick Start

### Installation

```bash
# Install all packages
npm install @naviprotocol/astros-aggregator-sdk @naviprotocol/astros-bridge-sdk @naviprotocol/lending @naviprotocol/wallet-client

# Or using yarn
yarn add @naviprotocol/astros-aggregator-sdk @naviprotocol/astros-bridge-sdk @naviprotocol/lending @naviprotocol/wallet-client

# Or using pnpm
pnpm add @naviprotocol/astros-aggregator-sdk @naviprotocol/astros-bridge-sdk @naviprotocol/lending @naviprotocol/wallet-client
```

### Basic Usage Examples

#### Token Swapping

```typescript
import { getQuote } from '@naviprotocol/astros-aggregator-sdk'

// Get swap quote
const quote = await getQuote(
  '0x2::sui::SUI', // Source token
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // Target token
  '1000000000' // Swap amount
)

console.log('Swap quote:', quote)
```

#### Cross-chain Bridging

```typescript
import { getQuote, swap } from '@naviprotocol/astros-bridge-sdk'

// Get cross-chain quote
const bridgeQuote = await getQuote(
  { address: '0x...', symbol: 'USDC', decimals: 6, chainId: 1 }, // Ethereum USDC
  { address: '0x2::sui::SUI', symbol: 'SUI', decimals: 9, chainId: 2 }, // Sui SUI
  '1000000' // 100 USDC
)

// Execute cross-chain swap
const transaction = await swap(bridgeQuote.routes[0], fromAddress, toAddress, walletConnection)
```

#### Lending Operations

```typescript
import { Account, Pool } from '@naviprotocol/lending'

// Initialize lending account
const account = new Account(client, signer)
await account.initialize()

// Deposit
const pool = new Pool(client, poolId)
const depositResult = await pool.deposit('0x2::sui::SUI', '1000000000', signer)
```

#### Wallet Client

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// Initialize wallet client
const keypair = new Ed25519Keypair()
const walletClient = new WalletClient({
  signer: keypair,
  configs: {
    swap: { baseUrl: 'https://api.navprotocol.io' },
    lending: { poolId: 'your-pool-id' }
  }
})

// Use swap module
const swapModule = walletClient.module('swap')
const quote = await swapModule.getQuote('0x2::sui::SUI', '0x...', '1000000000')
```

## 🛠️ Development

### Requirements

- Node.js >= 20
- pnpm >= 10.1.0

### Install Dependencies

```bash
pnpm install
```

### Build All Packages

```bash
pnpm build
```

### Run Tests

```bash
pnpm test
```

### Code Quality

```bash
pnpm lint
pnpm prettier
```

### Development Mode

```bash
pnpm dev
```

## 📚 Documentation

For detailed documentation of each package, please refer to the corresponding README files:

- [Astros Aggregator SDK](./packages/astros-aggregator-sdk/README.md)
- [Astros Bridge SDK](./packages/astros-bridge-sdk/README.md)
- [Lending SDK](./packages/lending/README.md)
- [Wallet Client](./packages/wallet-client/README.md)


### Contribution Process

1. Fork the project
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details

## 🆘 Support

- 📖 Documentation: [https://navprotocol.io](https://navprotocol.io)
- 🐛 Issues: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
- 💬 Community: [Discord](https://discord.gg/naviprotocol)
- 📧 Email: support@navprotocol.io

## 🔗 Related Links

- [NAVI Protocol Website](https://navprotocol.io)
- [Sui Blockchain](https://sui.io)
- [GitHub Repository](https://github.com/naviprotocol/naviprotocol-monorepo)

## 📊 Project Status

| Package | Version | Status |
|---|---|---|
| @naviprotocol/astros-aggregator-sdk | 1.0.4 | ✅ Stable |
| @naviprotocol/astros-bridge-sdk | 1.0.0 | ✅ Stable |
| @naviprotocol/lending | 1.0.0 | ✅ Stable |
| @naviprotocol/wallet-client | 1.0.0 | ✅ Stable |

---

**NAVI Protocol** - Building DeFi Infrastructure for the Sui Ecosystem 🚀 