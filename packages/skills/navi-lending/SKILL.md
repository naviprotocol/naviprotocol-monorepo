---
name: navi-lending
description: Low-level lending SDK for Sui blockchain NAVI Protocol, providing PTB-based transaction building for deposits, withdrawals, borrowing, repayments, flash loans, liquidation, EMode, oracle updates, and reward claiming. Use when building custom Programmable Transaction Blocks for lending operations, needing fine-grained control over lending transactions, or working with flash loans, EMode, market management, or oracle price feeds.
---

# NAVI Lending SDK

`@naviprotocol/lending` - Low-level lending operations with PTB control.

```bash
npm install @naviprotocol/lending
```

## Core Concepts

- **Health Factor**: > 1 is safe, <= 1 risks liquidation
- **Market**: Organizational unit grouping pools and EMode configs. Use `'main'` for the default market.
- **EMode**: Efficiency Mode for higher LTV within specific asset categories
- **PTB suffix**: Functions ending with `PTB` build Programmable Transaction Blocks

## Pool Operations

### Query Pools

```typescript
import { getPools, getPool, getStats } from '@naviprotocol/lending'

const pools = await getPools({ markets: ['main'], cacheTime: 30000 })
const pool = await getPool('0x2::sui::SUI')              // by coin type
const poolById = await getPool(0)                         // by asset ID
const stats = await getStats()                            // protocol TVL, total borrow, etc.
```

### Deposit

```typescript
import { depositCoinPTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
await depositCoinPTB(tx, '0x2::sui::SUI', coinObject, {
  amount: 1_000_000_000,
  accountCap: accountCapId,  // optional
  market: 'main'             // optional
})
```

### Withdraw

```typescript
import { withdrawCoinPTB } from '@naviprotocol/lending'

const tx = new Transaction()
const coin = await withdrawCoinPTB(tx, '0x2::sui::SUI', 1_000_000_000, {
  accountCap: accountCapId,  // optional
  market: 'main'             // optional
})
```

### Borrow

```typescript
import { borrowCoinPTB } from '@naviprotocol/lending'

const tx = new Transaction()
const coin = await borrowCoinPTB(tx, '0x2::sui::SUI', 1_000_000_000, {
  accountCap: accountCapId,  // optional
  market: 'main'             // optional
})
```

### Repay

```typescript
import { repayCoinPTB } from '@naviprotocol/lending'

const tx = new Transaction()
await repayCoinPTB(tx, '0x2::sui::SUI', coinObject, {
  amount: 1_000_000_000,
  accountCap: accountCapId,  // optional
  market: 'main'             // optional
})
```

## Account Management

```typescript
import { getLendingState, getHealthFactor, getCoins, mergeCoinsPTB } from '@naviprotocol/lending'

const state = await getLendingState(address)        // all supply/borrow positions
const hf = await getHealthFactor(address)           // health factor number
const coins = await getCoins(address)               // all coins owned
const mergedCoin = mergeCoinsPTB(tx, coins, coinType)  // merge coins in PTB
```

### Account Cap

```typescript
import { createAccountCapPTB } from '@naviprotocol/lending'

const tx = new Transaction()
const accountCap = await createAccountCapPTB(tx)
```

## Fee Queries

```typescript
import { getBorrowFee, getFees } from '@naviprotocol/lending'

const fee = await getBorrowFee()                                    // global fee rate
const specificFee = await getBorrowFee({ address: '0x...', asset: 'USDC' })  // per-address fee
const allFees = await getFees()                                     // detailed protocol fees
```

## Advanced Features

- **Flash Loans**: See [references/flashloan.md](references/flashloan.md) for collateral-free borrowing within a single transaction
- **EMode, Market, Oracle, Position, Liquidation**: See [references/advanced.md](references/advanced.md)
- **Reward System**: See [references/reward.md](references/reward.md) for claiming lending rewards
