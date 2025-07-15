# @naviprotocol/lending

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Flending.svg)](https://badge.fury.io/js/%40naviprotocol%2Flending)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Lending SDK is a lending SDK designed for the Sui blockchain. It provides complete lending functionality including account management, pool operations, flash loans, liquidation, and reward systems.

## Features

- 💰 **Lending Functions**: Supports deposit, borrow, repay and other basic lending operations
- ⚡ **Flash Loans**: Supports uncollateralized flash loan functionality
- 🔄 **Pool Management**: Complete pool operations and management
- 📊 **Price Oracle**: Integrated Pyth Network price oracle
- 🏆 **Reward System**: Supports liquidity mining and reward distribution
- 🔒 **Liquidation Mechanism**: Automatic liquidation mechanism to protect protocol security
- 📱 **Easy Integration**: Clean API design, easy to integrate into various applications

## Installation

```bash
npm install @naviprotocol/lending
# or
yarn add @naviprotocol/lending
# or
pnpm add @naviprotocol/lending
```

## Quick Start

### Initialize Account

```typescript
import { Account } from '@naviprotocol/lending'

// Create lending account
const account = new Account(client, signer)

// Initialize account
await account.initialize()
```

### Deposit Operations

```typescript
import { Pool } from '@naviprotocol/lending'

// Get pool information
const pool = new Pool(client, poolId)

// Deposit to pool
const depositResult = await pool.deposit(
  '0x2::sui::SUI', // Token type
  '1000000000', // Deposit amount (in smallest units)
  signer
)

console.log('Deposit result:', depositResult)
```

### Borrow Operations

```typescript
import { Pool } from '@naviprotocol/lending'

// Borrow from pool
const borrowResult = await pool.borrow(
  '0x2::sui::SUI', // Token type
  '500000000', // Borrow amount (in smallest units)
  signer
)

console.log('Borrow result:', borrowResult)
```

### Repay Operations

```typescript
import { Pool } from '@naviprotocol/lending'

// Repay to pool
const repayResult = await pool.repay(
  '0x2::sui::SUI', // Token type
  '500000000', // Repay amount (in smallest units)
  signer
)

console.log('Repay result:', repayResult)
```

### Flash Loans

```typescript
import { FlashLoan } from '@naviprotocol/lending'

// Create flash loan instance
const flashLoan = new FlashLoan(client, poolId)

// Execute flash loan
const flashLoanResult = await flashLoan.execute(
  '0x2::sui::SUI', // Token type
  '1000000000', // Flash loan amount
  async (borrowedAmount) => {
    // Execute your arbitrage logic here
    console.log('Borrowed amount:', borrowedAmount)
    
    // Example: simple arbitrage operation
    // const arbitrageResult = await performArbitrage(borrowedAmount)
    
    // Return the amount to repay (usually equals borrowed amount plus fees)
    return borrowedAmount
  },
  signer
)

console.log('Flash loan result:', flashLoanResult)
```

### Query Account Information

```typescript
import { Account } from '@naviprotocol/lending'

// Get account information
const accountInfo = await account.getAccountInfo()
console.log('Account info:', accountInfo)

// Get account balances
const balances = await account.getBalances()
console.log('Account balances:', balances)

// Get borrowing history
const history = await account.getBorrowHistory()
console.log('Borrowing history:', history)
```

### Query Pool Information

```typescript
import { Pool } from '@naviprotocol/lending'

// Get pool information
const poolInfo = await pool.getPoolInfo()
console.log('Pool info:', poolInfo)

// Get pool statistics
const stats = await pool.getPoolStats()
console.log('Pool stats:', stats)

// Get pool interest rates
const rates = await pool.getInterestRates()
console.log('Interest rates:', rates)
```

### Price Oracle

```typescript
import { Oracle } from '@naviprotocol/lending'

// Create oracle instance
const oracle = new Oracle(client)

// Get token price
const price = await oracle.getPrice('0x2::sui::SUI')
console.log('SUI price:', price)

// Get multiple token prices
const prices = await oracle.getPrices([
  '0x2::sui::SUI',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
])
console.log('Token prices:', prices)
```

### Reward System

```typescript
import { Reward } from '@naviprotocol/lending'

// Create reward instance
const reward = new Reward(client, poolId)

// Get reward information
const rewardInfo = await reward.getRewardInfo()
console.log('Reward info:', rewardInfo)

// Claim rewards
const claimResult = await reward.claim(signer)
console.log('Claim result:', claimResult)

// Get pending rewards
const pendingRewards = await reward.getPendingRewards()
console.log('Pending rewards:', pendingRewards)
```

## API Reference

### Account

Account management class for creating, initializing, and querying lending accounts.

```typescript
class Account {
  constructor(client: SuiClient, signer: Signer)
  
  // Initialize account
  initialize(): Promise<void>
  
  // Get account information
  getAccountInfo(): Promise<AccountInfo>
  
  // Get account balances
  getBalances(): Promise<Balance[]>
  
  // Get borrowing history
  getBorrowHistory(): Promise<BorrowHistory[]>
}
```

### Pool

Pool management class for handling deposit, borrow, repay operations.

```typescript
class Pool {
  constructor(client: SuiClient, poolId: string)
  
  // Deposit
  deposit(coinType: string, amount: string, signer: Signer): Promise<TransactionResult>
  
  // Borrow
  borrow(coinType: string, amount: string, signer: Signer): Promise<TransactionResult>
  
  // Repay
  repay(coinType: string, amount: string, signer: Signer): Promise<TransactionResult>
  
  // Get pool information
  getPoolInfo(): Promise<PoolInfo>
  
  // Get pool statistics
  getPoolStats(): Promise<PoolStats>
  
  // Get interest rates
  getInterestRates(): Promise<InterestRates>
}
```

### FlashLoan

Flash loan class supporting uncollateralized flash loan operations.

```typescript
class FlashLoan {
  constructor(client: SuiClient, poolId: string)
  
  // Execute flash loan
  execute(
    coinType: string,
    amount: string,
    callback: (borrowedAmount: string) => Promise<string>,
    signer: Signer
  ): Promise<TransactionResult>
}
```

### Oracle

Price oracle class providing token price query functionality.

```typescript
class Oracle {
  constructor(client: SuiClient)
  
  // Get single token price
  getPrice(coinType: string): Promise<number>
  
  // Get multiple token prices
  getPrices(coinTypes: string[]): Promise<Record<string, number>>
}
```

### Reward

Reward system class for handling reward queries and claims.

```typescript
class Reward {
  constructor(client: SuiClient, poolId: string)
  
  // Get reward information
  getRewardInfo(): Promise<RewardInfo>
  
  // Claim rewards
  claim(signer: Signer): Promise<TransactionResult>
  
  // Get pending rewards
  getPendingRewards(): Promise<PendingReward[]>
}
```

## Type Definitions

### AccountInfo

```typescript
interface AccountInfo {
  id: string
  owner: string
  // Other account information
}
```

### Balance

```typescript
interface Balance {
  coinType: string
  amount: string
  // Other balance information
}
```

### PoolInfo

```typescript
interface PoolInfo {
  id: string
  name: string
  totalSupply: string
  totalBorrow: string
  // Other pool information
}
```

### InterestRates

```typescript
interface InterestRates {
  supplyRate: number
  borrowRate: number
  // Other rate information
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

