# @naviprotocol/lending

## 2.0.10

### Patch Changes

- e66e711: Register the HIGH / USDC isolated market (`high-usdc`, market id 10) in `MARKETS`. HIGH (Ember High Income) is the supply-only collateral asset and native USDC the debt asset. Deployed on stage_v2 (`env: 'dev'`) 2026-08-26; without this entry `getMarketConfig`/`getMarket` throw `Market not found` for id 10 even though the open-api serves its config.
- 080192d: Rename the `ember` market's display name from `Ember Market` to `eACRED / USDC Market` (key and id unchanged), matching the pair-market naming style.

## 2.0.9

### Patch Changes

- new lending market: sui-eco, sui-usdc, wbtc-usdc, xbtc-usdc, vsui-usdc, vsui-sui, hasui-sui

## 2.0.8

### Patch Changes

- support sender-funded Pyth fees

## 2.0.7

### Patch Changes

- Fix NodeNext-compatible ESM output and package entry points.

## 2.0.6

### Patch Changes

- cbbdcf6: Fix Pyth price feed updates on the v2 Core (gRPC) client: price table entries are plain dynamic fields, so they are now fetched via `getDynamicField` instead of `getDynamicObjectField`, whose `Wrapper<PriceIdentifier>` derivation resolved to a nonexistent object and aborted every price refresh ("failed to update pyth price feeds, msg: Object 0x...").

## 2.0.5

### Patch Changes

- fix address-balance coin selection

## 2.0.4

### Patch Changes

- 2ae3e35: Fix Pyth price feed updates on the v2 Core (gRPC) client: price table entries are plain dynamic fields, so they are now fetched via `getDynamicField` instead of `getDynamicObjectField`, whose `Wrapper<PriceIdentifier>` derivation resolved to a nonexistent object and aborted every price refresh ("failed to update pyth price feeds, msg: Object 0x...").

## 2.0.0-beta.1

### Patch Changes

- Prepare the Sui SDK v2 beta release with Core API gRPC read/simulate support,
  explicit GraphQL capability wiring, Address Balances normalization, and
  service endpoint configuration for NAVI/Open API callers.

## 1.4.0

### Minor Changes

- Add EMode support with enhanced data structures and reward handling
- Upgrade oracle price update to v2 with switchboard aggregator
- Support multi-market queries and refactor data structures
- Improve lending rewards calculation with correct pool matching

### Patch Changes

- Fix lending position id and market issues
- Add new balance field to the Pool type
- Enhance documentation for oracle and account modules

## 1.3.2

### Patch Changes

- c0484fb: Add support for deprecating token pools.

## 1.2.0

### Minor Changes

- Move @mysten/sui to peer dependency

## 1.1.0

### Minor Changes

- Update sui package version
