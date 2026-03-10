# Staking Module (Haedal + Volo)

## Haedal Module (SUI -> haSUI)

### Configuration

```typescript
const walletClient = new WalletClient({
  configs: {
    haedal: { /* module-specific config */ }
  }
})
```

### Get APY

```typescript
const apy = await walletClient.haedal.getApy()
```

### Stake SUI

```typescript
const result = await walletClient.haedal.stake(
  1_000_000_000,   // amount in atomic units
  { dryRun: false }
)
```

### Unstake haSUI

```typescript
const result = await walletClient.haedal.unstake(
  1_000_000_000,
  { dryRun: false }
)
```

### PTB-level Operations

```typescript
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const haSuiCoin = await walletClient.haedal.stakePTB(tx, 1_000_000_000)
// or
const suiCoin = await walletClient.haedal.unstakePTB(tx, 1_000_000_000)

await walletClient.signExecuteTransaction({ transaction: tx })
```

### Events

```typescript
walletClient.events.on('haedal:stake-success', (data) => { /* ... */ })
walletClient.events.on('haedal:unstake-success', (data) => { /* ... */ })
```

---

## Volo Module (SUI -> vSUI)

### Get Stats

```typescript
const stats = await walletClient.volo.getStats()
```

### Stake SUI

```typescript
const result = await walletClient.volo.stake(
  1_000_000_000,
  { dryRun: false }
)
```

### Unstake vSUI

```typescript
const result = await walletClient.volo.unstake(
  1_000_000_000,
  { dryRun: false }
)
```

### PTB-level Operations

```typescript
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const vSuiCoin = await walletClient.volo.stakePTB(tx, 1_000_000_000)
// or
const suiCoin = await walletClient.volo.unstakePTB(tx, 1_000_000_000)

await walletClient.signExecuteTransaction({ transaction: tx })
```

### Events

```typescript
walletClient.events.on('volo:stake-success', (data) => { /* ... */ })
walletClient.events.on('volo:unstake-success', (data) => { /* ... */ })
```
