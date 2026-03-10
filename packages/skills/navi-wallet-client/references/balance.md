# Balance Module

## Configuration

```typescript
const walletClient = new WalletClient({
  configs: {
    balance: { coinPollingInterval: 6000 }  // polling interval in ms
  }
})
```

## coins

Get current token objects in the wallet.

```typescript
const coins = walletClient.balance.coins
// [{ coinObjectId, balance, coinType, digest, version }]
```

## portfolio

Aggregated balance data by coin type.

```typescript
const portfolio = walletClient.balance.portfolio
const suiBalance = portfolio.getBalance('0x2::sui::SUI')
// { amount: BigNumber, coins: [{ coinObjectId, balance, coinType }] }
```

## sendCoinBatch

Batch send tokens to multiple addresses.

```typescript
const result = await walletClient.balance.sendCoinBatch(
  '0x2::sui::SUI',
  ['0x123...', '0x456...'],       // recipient addresses
  [1_000_000_000, 2_000_000_000], // amounts
  { dryRun: false }
)
```

## transferObject

Transfer a single object (NFT, etc.) to an address.

```typescript
const result = await walletClient.balance.transferObject(
  '0x789...',    // object ID
  '0x123...',    // recipient
  { dryRun: false }
)
```

## transferObjectBatch

Batch transfer objects to multiple addresses.

```typescript
const result = await walletClient.balance.transferObjectBatch(
  ['0x789...', '0xabc...'],   // object IDs
  ['0x123...', '0x456...'],   // recipients
  { dryRun: false }
)
```

## updatePortfolio

Manually refresh coin data. Auto-refresh is built-in via polling and after successful contract calls.

```typescript
await walletClient.balance.updatePortfolio()
```

## Events

```typescript
walletClient.events.on('balance:portfolio-updated', () => { /* portfolio refreshed */ })
```
