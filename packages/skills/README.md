# NAVI Protocol Integration Skill

Agent skill for building on NAVI Protocol — Sui blockchain's comprehensive DeFi infrastructure. Gives agents the knowledge to integrate token swapping, lending, flash loans, cross-chain bridging, DCA strategies, and liquid staking.

## What's Included

```
skills/
├── SKILL.md                              # Entry point — SDK overview, package selection guide
├── README.md                             # This file
├── navi-wallet-client/
│   ├── SKILL.md                          # WalletClient setup, signer types, module access
│   └── references/
│       ├── balance.md                    # Portfolio, coins, token/object transfers
│       ├── lending.md                    # Deposit, withdraw, borrow, repay, liquidate, migrate
│       ├── swap.md                       # Token swapping, quotes, swap options
│       └── staking.md                    # Haedal (haSUI) and Volo (vSUI) liquid staking
├── navi-lending/
│   ├── SKILL.md                          # Core concepts, pool ops, PTB transaction building
│   └── references/
│       ├── flashloan.md                  # Collateral-free borrowing, arbitrage patterns
│       ├── advanced.md                   # EMode, market management, oracle, position, liquidation
│       └── reward.md                     # Reward queries and claiming
├── navi-swap/
│   └── SKILL.md                          # DEX aggregator quotes, swap PTB, MEV protection
├── navi-bridge/
│   └── SKILL.md                          # Cross-chain bridging, chain/token queries, status
└── navi-dca/
    └── SKILL.md                          # DCA order creation, cancellation, queries
```

## How It Works

The skill uses **progressive disclosure** to stay efficient with context:

1. **SKILL.md loads first** — contains SDK overview, package selection guide, and common conventions. Enough to route to the right sub-skill.
2. **Sub-skill SKILL.md loads on demand** — each package has its own SKILL.md with core API patterns and code examples (~100–135 lines each).
3. **Reference files load when needed** — deeper detail like flash loan patterns, EMode operations, or migration APIs are in separate reference files, loaded only when the task requires them.

This keeps the initial context small (~35 lines) while giving access to ~1,250 lines of detailed reference material when needed.

## When Agents Use This Skill

An agent activates this skill when a user asks about:

- **Wallet Integration** — WalletClient setup, private key / watch-only / browser extension signers
- **Token Swapping** — DEX aggregator quotes, swap execution, slippage protection, MEV protection via Shio
- **Lending** — deposit, withdraw, borrow, repay on NAVI lending pools, health factor monitoring
- **Flash Loans** — collateral-free borrowing within a single transaction, arbitrage strategies
- **EMode** — efficiency mode for higher LTV within asset categories
- **Cross-chain Bridging** — token transfers between Sui, Ethereum, Solana, Polygon, Avalanche, Arbitrum
- **DCA** — dollar-cost averaging automated orders with price range protection
- **Liquid Staking** — SUI staking via Haedal (haSUI) or Volo (vSUI)
- **Balance Management** — portfolio tracking, batch token transfers, object transfers
- **Rewards** — querying and claiming lending rewards
- **Oracle** — price feed queries and updates via Pyth/Supra

## Quick Start for Humans

If you're a developer reading this directly (not an agent), here's the fastest path:

### 1. Install the SDK

```bash
# High-level wallet client (recommended for most use cases)
npm install @naviprotocol/wallet-client

# Or individual packages for fine-grained control
npm install @naviprotocol/lending
npm install @naviprotocol/astros-aggregator-sdk
npm install @naviprotocol/astros-bridge-sdk
npm install @naviprotocol/astros-dca-sdk
```

### 2. Create a Wallet Client

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const walletClient = new WalletClient({
  client: { url: 'https://fullnode.mainnet.sui.io' },
  signer: Ed25519Keypair.fromSecretKey(privateKey)
})
```

### 3. Swap Tokens

```typescript
const result = await walletClient.swap.swap(
  '0x2::sui::SUI',
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
  1_000_000_000,  // 1 SUI
  0.01            // 1% slippage
)
```

### 4. Deposit into Lending Pool

```typescript
const result = await walletClient.lending.deposit(
  '0x2::sui::SUI',
  1_000_000_000   // 1 SUI
)
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **PTB** | Programmable Transaction Block — Sui's composable transaction model. Functions ending with `PTB` build transaction steps without executing |
| **Atomic Units** | All amounts are in smallest denomination (e.g., 1 SUI = 1,000,000,000) |
| **Health Factor** | Ratio measuring lending account safety. > 1 is safe, <= 1 risks liquidation |
| **EMode** | Efficiency Mode — higher LTV for correlated asset pairs |
| **Market** | Organizational unit grouping pools and EMode configs. Default is `'main'` |
| **Flash Loan** | Borrow without collateral, must repay within the same transaction |
| **Account Cap** | On-chain capability object for delegated account operations |

## Package Selection Guide

| Package | Use When | Level |
|---------|----------|-------|
| `@naviprotocol/wallet-client` | Need simple wallet integration with swap, lending, staking | High-level |
| `@naviprotocol/lending` | Need custom PTB transactions for lending operations | Low-level |
| `@naviprotocol/astros-aggregator-sdk` | Need direct DEX aggregator swap without wallet abstraction | Low-level |
| `@naviprotocol/astros-bridge-sdk` | Need cross-chain token transfers | Standalone |
| `@naviprotocol/astros-dca-sdk` | Need dollar-cost averaging orders | Standalone |

## Supported DEXs (Swap)

Aftermath, Bluefin, Cetus, DeepBook V3, Magma, Momentum, Turbos, KriyaV2/V3

## Supported Chains (Bridge)

Sui, Solana, Ethereum, Polygon, Avalanche, Arbitrum

## File Guide

| File | Read when you need to... |
|------|--------------------------|
| [SKILL.md](SKILL.md) | Get started — package selection and common conventions |
| [navi-wallet-client/SKILL.md](navi-wallet-client/SKILL.md) | Set up WalletClient, choose signer type, access modules |
| [navi-wallet-client/references/balance.md](navi-wallet-client/references/balance.md) | Track balances, transfer tokens or objects |
| [navi-wallet-client/references/lending.md](navi-wallet-client/references/lending.md) | Deposit, withdraw, borrow, repay, liquidate, or migrate positions |
| [navi-wallet-client/references/swap.md](navi-wallet-client/references/swap.md) | Swap tokens with quotes and slippage protection |
| [navi-wallet-client/references/staking.md](navi-wallet-client/references/staking.md) | Stake SUI for haSUI (Haedal) or vSUI (Volo) |
| [navi-lending/SKILL.md](navi-lending/SKILL.md) | Build custom PTB lending transactions |
| [navi-lending/references/flashloan.md](navi-lending/references/flashloan.md) | Borrow without collateral for arbitrage or debt restructuring |
| [navi-lending/references/advanced.md](navi-lending/references/advanced.md) | Use EMode, manage markets, update oracle prices, or liquidate |
| [navi-lending/references/reward.md](navi-lending/references/reward.md) | Query and claim lending rewards |
| [navi-swap/SKILL.md](navi-swap/SKILL.md) | Build PTB-level swap transactions with DEX aggregation |
| [navi-bridge/SKILL.md](navi-bridge/SKILL.md) | Bridge tokens between Sui and other chains |
| [navi-dca/SKILL.md](navi-dca/SKILL.md) | Create and manage DCA automated orders |

## Documentation

- [Astros Aggregator SDK](https://sdk.naviprotocol.io/swap)
- [Astros Bridge SDK](https://sdk.naviprotocol.io/bridge)
- [Lending SDK](https://sdk.naviprotocol.io/lending)
- [Wallet Client](https://sdk.naviprotocol.io/wallet-client)
- [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
