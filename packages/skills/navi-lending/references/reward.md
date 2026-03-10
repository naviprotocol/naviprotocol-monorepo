# Lending Reward System

## Query Available Rewards

```typescript
import { getUserAvailableLendingRewards, summaryLendingRewards } from '@naviprotocol/lending'

const rewards = await getUserAvailableLendingRewards(address, { cacheTime: 60000 })
const summary = await summaryLendingRewards(address)
```

## Query Claimed Rewards

```typescript
import { getUserTotalClaimedReward, getUserClaimedRewardHistory } from '@naviprotocol/lending'

const total = await getUserTotalClaimedReward(address)
const history = await getUserClaimedRewardHistory(address, { page: 1, size: 400 })
```

## Claim Rewards (PTB)

```typescript
import { claimLendingRewardsPTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()

// Claim all rewards
await claimLendingRewardsPTB(tx, rewards, { accountCap: accountCapId })

// Claim and re-supply (using customCoinReceive callback)
await claimLendingRewardsPTB(tx, rewards, {
  accountCap: accountCapId,
  customCoinReceive: (tx, coin, coinType) => {
    // Re-deposit claimed rewards
    depositCoinPTB(tx, coinType, coin)
  }
})
```
