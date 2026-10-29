# @naviprotocol/astros-bridge-sdk

## 2.2.0

### Minor Changes

- abda703: Support Mayan Fast MCTP (Circle CCTP v2) bridges from Sui. Mayan swap-sdk is bumped to 15.3.0, which builds Sui-source Fast MCTP orders; the Sui pre-swap input preparation and `preswapRouting: 'mayan'` (pre-swap requested without the referrer, simulated before signing and rebuilt from the same quote on a missed minimum or a malformed pre-swap) now cover Fast MCTP as well as MCTP. Bridge quote requests declare `BRIDGE_QUOTE_CAPABILITIES` (`fastMctp=1`, also exported for clients that call `/bridge-swap/find_routes` themselves), so the bridge API only offers Sui Fast MCTP routes to clients that can build them.

## 2.1.0

### Minor Changes

- 41e8f2b: Add opt-in `preswapRouting: 'mayan'` for Sui-source bridges. The Sui pre-swap is requested without the referrer while the bridge calls are unchanged (auction orders keep the referrer and its fee), and the transaction is simulated before signing and rebuilt from the same quote when the pre-swap misses the order minimum or comes back malformed. Quote minimums are unchanged; a missed minimum after retries, or a passed quote deadline, throws `BRIDGE_QUOTE_EXPIRED`.

### Patch Changes

- 72b88ee: Build the Sui pre-swap input locally so wallets holding SUI (or other non-USDC tokens) only as Sui address balance can bridge instead of failing with Mayan `NO_COINS`.

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
