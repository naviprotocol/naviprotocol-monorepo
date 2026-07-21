# @naviprotocol/lending

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
