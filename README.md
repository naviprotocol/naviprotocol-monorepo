# NAVI Protocol TypeScript SDK

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

## 🆙 SDK v1 vs v2

This monorepo is the **Sui SDK v2** generation of the NAVI TypeScript SDKs, replacing the legacy `navi-sdk` npm package.

| | v1 (`navi-sdk`) | v2 (this monorepo) |
| --- | --- | --- |
| Package | single `navi-sdk` npm package | `@naviprotocol/{lending,wallet-client,astros-aggregator-sdk,astros-bridge-sdk,astros-dca-sdk}` |
| Sui SDK | `@mysten/sui.js` | `@mysten/sui@^2` |
| Transaction | `TransactionBlock` | `Transaction` |
| Client | `SuiClient` (JSON-RPC only) | `SuiGrpcClient` (recommended) / `SuiJsonRpcClient` (legacy JSON-RPC, **deprecated, removed after 2026-07-31**) / `SuiGraphQLClient` — unified behind the `ClientWithCoreApi` interface |
| Module format | CommonJS | ESM |
| Runtime | — | Node.js 22+ |

Upgrading an existing `navi-sdk` integration? Read the **[Sui SDK v2 Migration guide](http://sdk.naviprotocol.io/sui-sdk-v2-migration)** first. Package-level migration notes (old `navi-sdk` → new packages) are kept under [NAVI SDK Migration](http://sdk.naviprotocol.io/navi-sdk-migration/lending).

## 📚 Documentation

- [Sui SDK v2 Migration](http://sdk.naviprotocol.io/sui-sdk-v2-migration)
- [Astros Aggregator SDK](http://sdk.naviprotocol.io/swap)
- [Astros Bridge SDK](http://sdk.naviprotocol.io/bridge)
- [Lending SDK](http://sdk.naviprotocol.io/lending)
- [Wallet Client](http://sdk.naviprotocol.io/wallet-client)
- [NAVI SDK Migration (from `navi-sdk`)](http://sdk.naviprotocol.io/navi-sdk-migration/lending)


### Contribution Process

1. Fork the project
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details

## 🆘 Support

- 📖 Documentation: [https://sdk.naviprotocol.io](https://sdk.naviprotocol.io)
- 🐛 Issues: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
- 📧 Email: zado@naviprotocol.io


## 📊 Project Status

| Package | Version | Status |
|---|---|---|
| @naviprotocol/astros-aggregator-sdk | 2.x | ✅ Sui SDK v2 |
| @naviprotocol/astros-bridge-sdk | 2.x | ✅ Sui SDK v2 |
| @naviprotocol/astros-dca-sdk | 2.x | ✅ Sui SDK v2 |
| @naviprotocol/lending | 2.x | ✅ Sui SDK v2 |
| @naviprotocol/wallet-client | 2.x | ✅ Sui SDK v2 |

Looking for the last stable v1 releases (`navi-sdk`-era)? See npm for the previously published 1.x versions of each package.

---

**NAVI Protocol** - Building DeFi Infrastructure for the Sui Ecosystem 🚀 