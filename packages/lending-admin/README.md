# `@naviprotocol/lending-admin`

Precision-safe NAVI lending admin SDK for Sui.

## Install

```bash
pnpm add @naviprotocol/lending-admin
```

## Get Admin Config

```ts
import { getAdminConfig } from '@naviprotocol/lending-admin'

const config = await getAdminConfig({
  env: 'dev',
  market: 'main'
})

console.log(config.lending.storageAdminCap)
console.log(config.oracle.oracleFeederCap)
```

## Safe vs Raw PTBs

Safe builders require explicit units for any tricky numeric input. Bare numbers are rejected.

```ts
import { Transaction } from '@mysten/sui/transactions'
import {
  setBaseRatePTB,
  setBaseRateRawPTB
} from '@naviprotocol/lending-admin'

const tx = new Transaction()

await setBaseRatePTB({
  tx,
  env: 'dev',
  market: 'main',
  assetId: 1,
  value: { value: '4', unit: 'percent' }
})

await setBaseRatePTB({
  tx,
  env: 'dev',
  market: 'main',
  assetId: 1,
  value: { value: '0.04', unit: 'ratio' }
})

await setBaseRateRawPTB({
  tx,
  env: 'dev',
  market: 'main',
  assetId: 1,
  value: '40000000000000000000000000'
})
```

The three calls above all serialize the same on-chain ray value.

## Precision Matrix

| Field category | Safe input | Raw input | Notes |
| --- | --- | --- | --- |
| Ray-backed ratio/rate fields | `RayRateInput` | `string` | `baseRate`, `multiplier`, `jumpRateMultiplier`, `reserveFactor`, `optimalUtilization`, `ltv`, `treasuryFactor`, `liquidationRatio`, `liquidationBonus`, `liquidationThreshold`, eMode `ltv/lt/bonus` |
| Coin-native atomic amount fields | `AmountInput` | `string` | flashloan `min/max`, treasury withdraw amounts, SUI pool target amount |
| Oracle price fields | `PriceInput` | `string` | price registration, price updates, effective price bounds |
| Explicit basis-point fields | `string` in a `*Bps*` API | `string` | borrow-fee setters, flashloan rate setters, borrow weights |

## Precision Helpers

```ts
import {
  percentToRay,
  ratioToRay,
  rayToRatio,
  tokenAmountToAtomic,
  atomicToTokenAmount
} from '@naviprotocol/lending-admin'

percentToRay('4')
ratioToRay('0.04')
rayToRatio('40000000000000000000000000')
tokenAmountToAtomic('1.5', 6)
atomicToTokenAmount('1500000', 6)
```

## Package Surface

- `reserve-admin`: reserve init, pause, reserve parameter setters, treasury withdraw, owner-cap mint
- `flashloan-admin`: flashloan config creation, asset creation, min/max/rate setters
- `oracle-admin`: feeder creation, interval updates, price registration/update, provider/feed config setters
- `incentive-admin`: incentive v3 create/migrate, reward fund flows, pool/rule creation, reward-rate setters, borrow-fee withdraw
- `borrow-fee-admin`: cap mint and default/asset/user fee overrides
- `emode-admin`: eMode asset/pair creation and config setters
- `liquidation-admin`: designated liquidators and protected users
- `market-admin`: new market, market field init, borrow-weight controls
- `pool-admin`: generic pool treasury admin and SUI pool-manager controls

## Notes

- `getAdminConfig()` depends on the additive `/api/navi/config` admin payload exposed by `navi-open-api`.
- This package mirrors `@naviprotocol/lending` transport and cache conventions without taking a runtime dependency on it.
- Placeholder Move entrypoints that intentionally abort are not wrapped; the SDK targets the externally callable production admin paths.
