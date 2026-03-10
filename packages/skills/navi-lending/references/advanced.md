# Advanced Lending Features

## EMode (Efficiency Mode)

Higher LTV ratios within specific asset categories for improved capital efficiency.

### Enter / Exit EMode

```typescript
import { enterEModePTB, exitEModePTB, createEModeCapPTB, getUserEModeCaps } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()

// Create EMode cap (combines account cap + EMode functionality)
const emodeCap = await createEModeCapPTB(tx, emodeId, { market: 'main' })

// Enter EMode
await enterEModePTB(tx, emodeId, { accountCap: accountCapId, market: 'main' })

// Exit EMode
await exitEModePTB(tx, { accountCap: accountCapId, market: 'main' })

// Query user's EMode caps
const caps = await getUserEModeCaps(address)
```

### EMode Identity

```typescript
import { emodeIdentityId } from '@naviprotocol/lending'

const id = emodeIdentityId(emodeId, { market: 'main' })
```

## Market Management

Markets group pools and EMode configs. The default market is `'main'`.

```typescript
import { getMarket, getMarkets, getMarketConfig, MARKETS, DEFAULT_MARKET_IDENTITY } from '@naviprotocol/lending'

const config = await getMarketConfig({ env: 'prod' })
const market = await getMarket('main')         // returns Market instance
const markets = await getMarkets(['main', 0])  // multiple markets

// Market class methods
const emode = market.getEMode(emodeId)
const emodePools = market.getEModePools(emodeId)
const overview = market.overview()

// Predefined markets
console.log(MARKETS)                    // all market identifiers
console.log(DEFAULT_MARKET_IDENTITY)    // default market
```

## Oracle (Decentralized Price Feeds)

Integrates Pyth and Supra oracles. PUSH model with 15-second price validity.

### Query Price Feeds

```typescript
import { getPriceFeeds, filterPriceFeeds } from '@naviprotocol/lending'

const feeds = await getPriceFeeds({ env: 'prod', cacheTime: 30000 })
const suiFeeds = filterPriceFeeds(feeds, { coinType: '0x2::sui::SUI' })
```

### Update Oracle Prices in PTB

```typescript
import { updateOraclePricesPTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
await updateOraclePricesPTB(tx, { env: 'prod' })
```

### Pyth Stale Price Detection

```typescript
import { getPythStalePriceFeedId, getPythStalePriceFeedIdV2, updatePythPriceFeeds } from '@naviprotocol/lending'

const staleIds = await getPythStalePriceFeedId({ env: 'prod' })
const staleIdsV2 = await getPythStalePriceFeedIdV2({ client: suiClient })
await updatePythPriceFeeds(tx, staleIds, { env: 'prod' })
```

## Position Management

Structured position view with EMode support and automatic value calculations.

```typescript
import { getLendingPositions } from '@naviprotocol/lending'

const positions = await getLendingPositions(address)

// UserPositions class methods
positions.deposit(poolId)     // deposit position for a pool
positions.withdraw(poolId)    // withdraw position
positions.borrow(poolId)      // borrow position
positions.repay(poolId)       // repay position
positions.findPositionsByPool(poolId)  // all positions for a pool
```

Advantages over `getLendingState`: includes EMode status, calculated USD values, position categorization, overview statistics.

## Liquidation

When a borrower's health factor drops below the liquidation threshold:

```typescript
import { liquidatePTB } from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
await liquidatePTB(
  tx,
  payAsset,                // asset to repay debt
  payAmount,               // repayment amount
  collateralAsset,         // collateral to receive
  liquidationAddress,      // borrower's address
  { env: 'prod', market: 'main' }
)
```
