# @naviprotocol/lending

## 1.4.4-beta.11

### Patch Changes

- Fix lending position amount drift right after deposit/withdraw/borrow/repay.
  `getLendingStateBatch` now reads `supply_index` / `borrow_index` on-chain in
  the same PTB as `get_user_state` (via `getter::get_reserve_data`) instead of
  relying on the cached open-api `/api/navi/pools` snapshot, so the displayed
  `supplyBalance` / `borrowBalance` no longer lags behind the chain by the
  open-api indexer delay. Falls back to the pool indices from the open-api
  response if reserve data cannot be decoded.

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
