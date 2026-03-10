# Lending Module

## Configuration

```typescript
const walletClient = new WalletClient({
  configs: {
    lending: { env: 'prod' }
  }
})
```

## Pool Queries

```typescript
const pools = await walletClient.lending.getPools({ cacheTime: 60000 })
const pool = await walletClient.lending.getPool('0x2::sui::SUI', { cacheTime: 60000 })
```

## Deposit

```typescript
const result = await walletClient.lending.deposit(
  '0x2::sui::SUI',      // asset identifier
  1_000_000_000,         // amount in atomic units
  { dryRun: false, accountCap: '0x...' }
)
```

## Withdraw

```typescript
const result = await walletClient.lending.withdraw(
  '0x2::sui::SUI',
  1_000_000_000,
  { dryRun: false, disableUpdateOracle: false, accountCap: '0x...' }
)
```

## Borrow

```typescript
const result = await walletClient.lending.borrow(
  '0x2::sui::SUI',
  1_000_000_000,
  { dryRun: false, accountCap: '0x...' }
)
```

## Repay

```typescript
const result = await walletClient.lending.repay(
  '0x2::sui::SUI',
  1_000_000_000,
  { dryRun: false, accountCap: '0x...' }
)
```

## Health Factor

```typescript
const hf = await walletClient.lending.getHealthFactor()
```

## Liquidation

```typescript
const result = await walletClient.lending.liquidate(
  'SUI',           // debt asset
  1_000_000_000,   // debt amount
  'USDC',          // collateral asset
  '0x123...',      // liquidation target address
  { dryRun: false }
)
```

## Rewards

```typescript
const rewards = await walletClient.lending.getAvailableRewards({ cacheTime: 60000 })
const history = await walletClient.lending.getClaimedRewardHistory({ page: 1, size: 10 })
const result = await walletClient.lending.claimAllRewards({ dryRun: false, accountCap: '0x...' })
```

## Lending State

```typescript
const state = await walletClient.lending.getLendingState({ cacheTime: 60000 })
// [{ assetId, borrowBalance, supplyBalance, pool: { coinType, id, ... } }]
```

## Account Cap

```typescript
const result = await walletClient.lending.createAccountCap({ dryRun: false })
```

## Oracle Update

```typescript
const result = await walletClient.lending.updateOracle({ dryRun: false })
```

## Migration (PTB-level)

### Migrate between supply pools

```typescript
const tx = new Transaction()
await walletClient.lending.migrateBetweenSupplyPTB(tx, sourceCoinType, targetCoinType, {
  amount: 1_000_000,
  slippage: 0.002
})
await walletClient.signExecuteTransaction({ transaction: tx })
```

### Migrate between borrow pools

```typescript
const tx = new Transaction()
await walletClient.lending.migrateBetweenBorrowPTB(tx, sourceDebtType, targetDebtType, {
  amount: 1_000_000,
  slippage: 0.002
})
await walletClient.signExecuteTransaction({ transaction: tx })
```

### Migrate wallet balance to supply pool

```typescript
const tx = new Transaction()
await walletClient.lending.migrateBalanceToSupplyPTB(tx, walletAssetType, targetSupplyType, {
  amount: 1_000_000_000,
  slippage: 0.002
})
await walletClient.signExecuteTransaction({ transaction: tx })
```

## Events

```typescript
walletClient.events.on('lending:deposit-success', (data) => { /* { identifier, amount } */ })
walletClient.events.on('lending:withdraw-success', (data) => { /* { identifier, amount } */ })
walletClient.events.on('lending:borrow-success', (data) => { /* { identifier, amount } */ })
walletClient.events.on('lending:repay-success', (data) => { /* { identifier, amount } */ })
walletClient.events.on('lending:liquidate-success', (data) => { /* { payIdentifier, payAmount, collateralIdentifier, liquidationAddress } */ })
walletClient.events.on('lending:claim-rewards-success', (data) => { /* { rewards } */ })
```
