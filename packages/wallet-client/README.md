# @naviprotocol/wallet-client

[![npm version](https://badge.fury.io/js/%40naviprotocol%2Fwallet-client.svg)](https://badge.fury.io/js/%40naviprotocol%2Fwallet-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Wallet Client is a comprehensive wallet client SDK designed for the Sui blockchain. It provides a unified interface for managing transaction signing, account management, and various DeFi operations including token swapping, lending, and balance management.

## Documentation

For SDK documentation visit http://sdk.naviprotocol.io/wallet-client


## Core Features

- 🔐 **Transaction Signing**: Complete transaction signing and execution functionality
- 💰 **Token Swapping**: Integrated Astros aggregator for token swapping
- 🏦 **Lending Features**: Integrated lending protocol for deposit and borrow operations
- 💳 **Balance Management**: Complete wallet balance and portfolio management
- 🔄 **Modular Design**: Modular architecture for easy extension and maintenance
- 📱 **Easy Integration**: Clear API design for easy integration into various applications
- 🎯 **Type Safety**: Complete TypeScript type support

## Supported Modules

### [Balance Module](./wallet-client/balance)
Provides comprehensive wallet balance management functionality, including token tracking, portfolio management, token transfers, and automatic balance updates.

**Key Features:**
- Real-time balance tracking
- Token transfers
- Object transfers
- Automatic balance updates

### [Swap Module](./wallet-client/swap)
Provides DEX token swapping functionality, integrated with Astros aggregator to find optimal swap paths and execute trades across multiple decentralized exchanges.

**Key Features:**
- Token swapping
- Aggregator integration
- Slippage protection
- Multi-DEX support

### [Lending Module](./wallet-client/lending)
Provides comprehensive lending protocol functionality, including deposits, withdrawals, borrowing, repayments, liquidations, reward claiming, and oracle price updates.

**Key Features:**
- Deposits and withdrawals
- Borrowing and repayments
- Liquidation functionality
- Reward management
- Oracle updates

### [Haedal Module](./wallet-client/haedal)
Provides Haedal protocol staking and unstaking functionality, allowing users to stake SUI to receive haSUI and obtain APY statistics.

**Key Features:**
- SUI staking
- haSUI unstaking
- APY queries

### [Volo Module](./wallet-client/volo)
Provides Volo staking protocol functionality, allowing users to stake SUI tokens and receive vSUI (volo SUI) tokens for liquid staking.

**Key Features:**
- SUI staking
- vSUI unstaking
- Statistics queries
- APY queries

## Installation

```bash
npm install @naviprotocol/wallet-client
```

## Sui SDK v2 Notes

`@naviprotocol/wallet-client@2` defaults to the Sui SDK v2 main path. The legacy
Suilend adapter remains an optional peer dependency and is loaded lazily when
the lending protocol registry is initialized. This preserves the v1
cross-protocol migration behavior without adding the Suilend stack to the root
SDK import path. Install the optional peers when you use the Suilend migration
path:

```bash
npm install @suilend/sdk@1.1.75 @suilend/sui-fe@0.3.20
```

```ts
const walletClient = new WalletClient({
  signer,
  client: { url: getJsonRpcFullnodeUrl('mainnet') }
})
```

If an app does not use Suilend, it can explicitly opt out:

```ts
const walletClient = new WalletClient({
  signer,
  client: { url: getJsonRpcFullnodeUrl('mainnet') },
  configs: {
    lending: {
      enableSuilend: false
    }
  }
})
```

This optional path remains a compatibility adapter until a verified Suilend
v2-safe stack is available.

## Quick Start

```ts
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { WalletClient, WatchSigner } from '@naviprotocol/wallet-client'

const address = '0x0000000000000000000000000000000000000000000000000000000000000001'
const walletClient = new WalletClient({
  signer: new WatchSigner(address),
  client: {
    url: getJsonRpcFullnodeUrl('mainnet')
  }
})

// Use balance module
const portfolio = walletClient.balance.portfolio
const suiBalance = portfolio.getBalance('0x2::sui::SUI')

// Use swap module
const result = await walletClient.swap.swap(
  '0x2::sui::SUI',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
  1000000000,
  0.01,
  { dryRun: true }
)

// Use lending module
const healthFactor = await walletClient.lending.getHealthFactor()
const pools = await walletClient.lending.getPools()

// Use Haedal module
const apy = await walletClient.haedal.getApy()
const stakeResult = await walletClient.haedal.stake(1000000000, { dryRun: true })

// Use Volo module
const stats = await walletClient.volo.getStats()
const voloStakeResult = await walletClient.volo.stake(1000000000, { dryRun: true })
```

## Event Listening

```ts
// Listen for balance updates
walletClient.events.on('balance:portfolio-updated', () => {
  console.log('Portfolio updated')
})

// Listen for swap success
walletClient.events.on('swap:swap-success', (data) => {
  console.log('Swap successful:', data)
})

// Listen for lending operations
walletClient.events.on('lending:deposit-success', (data) => {
  console.log('Deposit successful:', data)
})

// Listen for staking operations
walletClient.events.on('haedal:stake-success', (data) => {
  console.log('Haedal staking successful:', data)
})

walletClient.events.on('volo:stake-success', (data) => {
  console.log('Volo staking successful:', data)
})
```

## Support

- Issue reporting: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
