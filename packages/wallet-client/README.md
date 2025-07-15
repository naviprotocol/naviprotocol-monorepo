# @naviprotocol/wallet-client

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Fwallet-client.svg)](https://badge.fury.io/js/%40naviprotocol%2Fwallet-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Wallet Client is a comprehensive wallet client SDK designed for the Sui blockchain. It provides a unified interface for managing transaction signing, account management, and various DeFi operations including token swapping, lending, and balance management.

## Features

- 🔐 **Transaction Signing**: Complete transaction signing and execution functionality
- 💰 **Token Swapping**: Integrated Astros aggregator for token swapping
- 🏦 **Lending Functions**: Integrated lending protocols for deposit and borrow operations
- 💳 **Balance Management**: Complete wallet balance and portfolio management
- 🔄 **Modular Design**: Modular architecture, easy to extend and maintain
- 📱 **Easy Integration**: Clean API design, easy to integrate into various applications
- 🎯 **Type Safe**: Complete TypeScript type support

## Supported Modules

- **Swap Module**: Token swapping functionality
- **Lending Module**: Lending functionality
- **Balance Module**: Balance and portfolio management
- **Haedal Module**: Haedal protocol integration
- **Volo Module**: Volo protocol integration

## Installation

```bash
npm install @naviprotocol/wallet-client
# or
yarn add @naviprotocol/wallet-client
# or
pnpm add @naviprotocol/wallet-client
```

## Quick Start

### Initialize Wallet Client

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// Create keypair
const keypair = new Ed25519Keypair()

// Initialize wallet client
const walletClient = new WalletClient({
  signer: keypair,
  configs: {
    // Optional module configurations
    swap: {
      baseUrl: 'https://api.navprotocol.io'
    },
    lending: {
      poolId: 'your-pool-id'
    }
  }
})

console.log('Wallet address:', walletClient.address)
```

### Token Swapping

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'

// Get swap module
const swapModule = walletClient.module('swap')

// Get swap quote
const quote = await swapModule.getQuote(
  '0x2::sui::SUI', // Source token address
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // Target token address
  '1000000000' // Swap amount
)

console.log('Swap quote:', quote)

// Execute swap
const swapResult = await swapModule.swap(quote.routes[0])
console.log('Swap result:', swapResult)
```

### Lending Operations

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'

// Get lending module
const lendingModule = walletClient.module('lending')

// Deposit
const depositResult = await lendingModule.deposit(
  '0x2::sui::SUI', // Token type
  '1000000000' // Deposit amount
)
console.log('Deposit result:', depositResult)

// Borrow
const borrowResult = await lendingModule.borrow(
  '0x2::sui::SUI', // Token type
  '500000000' // Borrow amount
)
console.log('Borrow result:', borrowResult)
```

### Balance Management

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'

// Get balance module
const balanceModule = walletClient.module('balance')

// Get wallet balances
const balances = await balanceModule.getBalances()
console.log('Wallet balances:', balances)

// Get portfolio information
const portfolio = await balanceModule.getPortfolio()
console.log('Portfolio:', portfolio)

// Get specific token balance
const suiBalance = await balanceModule.getTokenBalance('0x2::sui::SUI')
console.log('SUI balance:', suiBalance)
```

### Transaction Execution

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'
import { Transaction } from '@mysten/sui/transactions'

// Create transaction block
const txb = new Transaction()

// Add transaction operations
// ... add specific transaction operations

// Sign and execute transaction
const result = await walletClient.signExecuteTransaction({
  transaction: txb,
  requestType: 'WaitForLocalExecution',
  options: {
    showEffects: true
  }
})

console.log('Transaction result:', result)

// Dry run transaction
const dryRunResult = await walletClient.signExecuteTransaction({
  transaction: txb,
  dryRun: true
})

console.log('Dry run result:', dryRunResult)
```

### Event Listening

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'

// Listen to module events
walletClient.events.on('swap:quote', (quote) => {
  console.log('Received swap quote:', quote)
})

walletClient.events.on('lending:deposit', (result) => {
  console.log('Deposit completed:', result)
})

walletClient.events.on('balance:update', (balances) => {
  console.log('Balance updated:', balances)
})
```

### Module Configuration

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'

// Get module configurations
const swapConfig = walletClient.config('swap')
console.log('Swap module config:', swapConfig)

const lendingConfig = walletClient.config('lending')
console.log('Lending module config:', lendingConfig)

// Check if module is available
if (walletClient.hasModule('swap')) {
  console.log('Swap module is available')
}
```

## API Reference

### WalletClient

Main wallet client class.

```typescript
class WalletClient {
  constructor(options: WalletClientOptions)
  
  // Get wallet address
  get address(): string
  
  // Get module
  module<TName extends ModuleName>(name: TName): (typeof modules)[TName]
  
  // Get module configuration
  config<TName extends ModuleName>(name: TName): ExtractModuleConfig<(typeof modules)[TName]>
  
  // Check if module is available
  hasModule(name: ModuleName): boolean
  
  // Sign and execute transaction
  signExecuteTransaction(options: {
    transaction: Uint8Array | Transaction
    dryRun?: boolean
    requestType?: string
    options?: any
  }): Promise<any>
}
```

### Swap Module

Token swapping module.

```typescript
class SwapModule {
  // Get swap quote
  getQuote(
    fromCoinAddress: string,
    toCoinAddress: string,
    amountIn: string | number | bigint,
    options?: SwapOptions
  ): Promise<Quote>
  
  // Execute swap
  swap(quote: Quote): Promise<TransactionResult>
}
```

### Lending Module

Lending module.

```typescript
class LendingModule {
  // Deposit
  deposit(coinType: string, amount: string): Promise<TransactionResult>
  
  // Borrow
  borrow(coinType: string, amount: string): Promise<TransactionResult>
  
  // Repay
  repay(coinType: string, amount: string): Promise<TransactionResult>
  
  // Get account information
  getAccountInfo(): Promise<AccountInfo>
}
```

### Balance Module

Balance management module.

```typescript
class BalanceModule {
  // Get all balances
  getBalances(): Promise<Balance[]>
  
  // Get portfolio
  getPortfolio(): Promise<Portfolio>
  
  // Get specific token balance
  getTokenBalance(coinType: string): Promise<Balance>
}
```

## Type Definitions

### WalletClientOptions

```typescript
interface WalletClientOptions {
  signer: Signer
  configs?: Partial<UserConfigs>
  client?: SuiClientOptions
}
```

### ModuleName

```typescript
type ModuleName = 'swap' | 'lending' | 'balance' | 'haedal' | 'volo'
```

### Quote

```typescript
interface Quote {
  routes: Route[]
  // Other quote information
}
```

### TransactionResult

```typescript
interface TransactionResult {
  digest: string
  effects: any
  // Other transaction result information
}
```

## Module Configuration

### Swap Module Configuration

```typescript
interface SwapModuleConfig {
  baseUrl?: string
  apiKey?: string
  // Other configuration options
}
```

### Lending Module Configuration

```typescript
interface LendingModuleConfig {
  poolId: string
  // Other configuration options
}
```

### Balance Module Configuration

```typescript
interface BalanceModuleConfig {
  refreshInterval?: number
  // Other configuration options
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

