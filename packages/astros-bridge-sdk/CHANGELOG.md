# @naviprotocol/astros-bridge-sdk

## 2.0.2

### Patch Changes

- 08793e1: fix(bridge): bump @mayanfinance/swap-sdk 15.0.0 → 15.2.2 to fix Sui
  address-balance coin selection

  Mayan swap-sdk 15.0.0 gathered Sui source coins via `core.listCoins`
  only, so funds held in the Sui V2 address-balance accumulator
  (`getBalance().addressBalance`) were invisible to coin selection. When a
  bridge amount exceeded the sum of plain `Coin<T>` objects, the build
  threw a misleading `Insufficient funds to create Coin <type> with amount
<X>` even though the wallet held far more — small amounts passed, large
  amounts failed (reproduced on Sui→Solana USDC bridge). Mayan 15.2.2
  backfills the accumulator (`getBalance().addressBalance` +
  `0x2::coin::redeem_funds`), matching the fix already applied to the
  aggregator/dca/lending coin selection.

## 2.0.1

### Patch Changes

- Fix NodeNext-compatible ESM output and package entry points.

## 2.0.0-beta.1

### Patch Changes

- Prepare the Sui SDK v2 beta release with Mayan v2 Sui-source bridge support,
  explicit internal legacy JSON-RPC build-client handling for route-specific
  Mayan compatibility, and a package type-test release gate.

## 1.2.1

### Patch Changes

- Upgrade @mayanfinance/swap-sdk to 13.3.0.

## 1.2.0

### Minor Changes

- Move @mysten/sui to peer dependency

## 1.1.0

### Minor Changes

- Update sui package version
