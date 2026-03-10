# Flash Loan Operations

Borrow assets without collateral, repay within the same transaction. Atomic execution — if repayment fails, the entire transaction reverts.

## Discover Available Assets

```typescript
import { getAllFlashLoanAssets, getFlashLoanAsset } from '@naviprotocol/lending'

const assets = await getAllFlashLoanAssets({ env: 'prod', cacheTime: 30000 })
// Key fields: max (max borrowable), flashloanFee (fee rate), coinType

const suiAsset = await getFlashLoanAsset('0x2::sui::SUI')
const assetById = await getFlashLoanAsset(0)
```

## Borrow (flashloanPTB)

```typescript
import { flashloanPTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const [balance, receipt] = await flashloanPTB(
  tx,
  '0x2::sui::SUI',
  1_000_000_000,
  { env: 'prod' }
)
// balance: borrowed asset balance
// receipt: required for repayment
```

## Repay (repayFlashLoanPTB)

Repayment balance must include borrowed amount + flash loan fee.

```typescript
import { repayFlashLoanPTB } from '@naviprotocol/lending'

await repayFlashLoanPTB(tx, '0x2::sui::SUI', receipt, balance, { env: 'prod' })
```

## Complete Arbitrage Example

```typescript
import { flashloanPTB, repayFlashLoanPTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

async function flashLoanArbitrage() {
  const tx = new Transaction()

  const [borrowedBalance, receipt] = await flashloanPTB(
    tx, '0x2::sui::SUI', 1_000_000_000, { env: 'prod' }
  )

  // Execute arbitrage logic here (e.g., swap on DEX A, swap back on DEX B)

  await repayFlashLoanPTB(tx, '0x2::sui::SUI', receipt, borrowedBalance, { env: 'prod' })

  // Sign and submit tx
}
```

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| Transaction reverted | Borrow and repay not in same tx | Use same PTB for both |
| Insufficient repayment | Fee not included | Repay borrowed + flashloanFee |
| Unsupported asset | Pool doesn't support flash loans | Check getAllFlashLoanAssets first |
| Amount exceeds limit | Over max borrowable | Check `max` field before borrowing |
| Missing receipt | Receipt not passed correctly | Use receipt from flashloanPTB return |
