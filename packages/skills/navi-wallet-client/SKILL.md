---
name: navi-wallet-client
description: High-level wallet client SDK for Sui blockchain DeFi integration with NAVI Protocol. Provides unified interface for transaction signing, token swapping (via Astros aggregator), lending (deposit/withdraw/borrow/repay), balance management, and liquid staking (Haedal haSUI, Volo vSUI). Use when integrating wallet functionality, performing DeFi operations through a simple API, or when the user needs swap, lending, staking, or balance features without building PTB transactions manually.
---

# NAVI Wallet Client SDK

`@naviprotocol/wallet-client` - High-level unified DeFi client for Sui.

```bash
npm install @naviprotocol/wallet-client
```

## Initialization

Three signer types are supported:

### Private Key Wallet

```typescript
import { WalletClient } from '@naviprotocol/wallet-client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const walletClient = new WalletClient({
  client: { url: 'https://fullnode.mainnet.sui.io' },
  signer: Ed25519Keypair.fromSecretKey(privateKey),
  configs: {
    swap: {
      serviceFee: { recipient: '0x...', fee: 0.001 }
    }
  }
})
```

### Watch-Only Wallet (read-only, no transaction signing)

```typescript
import { WalletClient, WatchSigner } from '@naviprotocol/wallet-client'

const walletClient = new WalletClient({
  client: { url: 'https://fullnode.mainnet.sui.io' },
  signer: new WatchSigner('0xADDRESS')
})
```

### Browser Extension Wallet

```typescript
import { WalletClient, WebSigner } from '@naviprotocol/wallet-client'

class WebSignerAdapter extends WebSigner {
  constructor(address: string) { super(address) }
  async signAndExecuteTransaction({ transaction, client }) {
    return await this.walletExtension.signAndExecuteTransaction(transaction)
  }
  async signTransaction(bytes: Uint8Array) {
    return await this.walletExtension.signTransaction(bytes)
  }
  async signPersonalMessage(bytes: Uint8Array) {
    return await this.walletExtension.signPersonalMessage(bytes)
  }
}

const walletClient = new WalletClient({
  signer: new WebSignerAdapter('0x...')
})
```

## Core Properties & Methods

- `walletClient.address` - Current wallet address
- `walletClient.balance` - Balance module
- `walletClient.swap` - Swap module
- `walletClient.lending` - Lending module
- `walletClient.haedal` - Haedal staking module
- `walletClient.volo` - Volo staking module
- `walletClient.signExecuteTransaction({ transaction, dryRun? })` - Sign and execute transaction

## Event Listening

```typescript
walletClient.events.on('balance:portfolio-updated', () => { /* ... */ })
walletClient.events.on('swap:swap-success', (data) => { /* ... */ })
walletClient.events.on('lending:deposit-success', (data) => { /* ... */ })
walletClient.events.on('haedal:stake-success', (data) => { /* ... */ })
walletClient.events.on('volo:stake-success', (data) => { /* ... */ })
```

## Module Details

- **Balance**: See [references/balance.md](references/balance.md) for coins, portfolio, transfers
- **Lending**: See [references/lending.md](references/lending.md) for deposit, withdraw, borrow, repay, liquidate, rewards, migration
- **Swap**: See [references/swap.md](references/swap.md) for token swapping, quotes, swap options
- **Staking**: See [references/staking.md](references/staking.md) for Haedal (haSUI) and Volo (vSUI) liquid staking
