---
name: navi-sdk-overview
description: NAVI Protocol TypeScript SDK overview and package selection guide for Sui blockchain DeFi integration. Use when working with NAVI Protocol, Sui DeFi, token swapping, lending, cross-chain bridging, DCA, or when unsure which @naviprotocol package to use. Covers wallet-client, lending, astros-aggregator-sdk, astros-bridge-sdk, and astros-dca-sdk.
---

# NAVI Protocol SDK Overview

Monorepo of TypeScript SDKs for Sui blockchain DeFi. All packages require `@mysten/sui` >= 1.25.0 as peer dependency.

## Package Selection Guide

| Package | Use When | Level |
|---|---|---|
| `@naviprotocol/wallet-client` | Need simple wallet integration with swap, lending, staking | High-level |
| `@naviprotocol/lending` | Need custom PTB transactions for lending operations | Low-level |
| `@naviprotocol/astros-aggregator-sdk` | Need direct DEX aggregator swap without wallet abstraction | Low-level |
| `@naviprotocol/astros-bridge-sdk` | Need cross-chain token transfers | Standalone |
| `@naviprotocol/astros-dca-sdk` | Need dollar-cost averaging orders | Standalone |

**Decision rule**: Start with `wallet-client` for most use cases. Use `lending` or `astros-aggregator-sdk` only when you need PTB-level control over transactions.

## Common Conventions

- Interfaces ending with `PTB` are for building Programmable Transaction Blocks
- The last `options` parameter is usually optional, supporting: `client` (SuiClient), `env` ('prod'|'dev'), `cacheTime` (ms), `disableCache`, `accountCap`, `market`
- Amounts are in atomic units (e.g., 1 SUI = 1_000_000_000)

## Detailed Skill References

- **Wallet Client**: See [navi-wallet-client/SKILL.md](navi-wallet-client/SKILL.md) for WalletClient initialization, balance, swap, lending, staking modules
- **Lending SDK**: See [navi-lending/SKILL.md](navi-lending/SKILL.md) for low-level pool operations, flash loans, EMode, oracle, rewards
- **Swap SDK**: See [navi-swap/SKILL.md](navi-swap/SKILL.md) for DEX aggregator quotes, swap transactions, MEV protection
- **Bridge SDK**: See [navi-bridge/SKILL.md](navi-bridge/SKILL.md) for cross-chain bridging operations
- **DCA SDK**: See [navi-dca/SKILL.md](navi-dca/SKILL.md) for dollar-cost averaging order management
