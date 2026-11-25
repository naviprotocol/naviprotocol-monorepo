# @naviprotocol/multiply

## 0.3.1

### Patch Changes

- 4e4283c: Fix problems found by a review of the 0.2.0 / 0.3.0 code, each reproduced first (mainnet read-only simulation or a unit test).

  - Depend on `@naviprotocol/astros-aggregator-sdk` 2.0.9. 2.0.7 routed DeepBook hops through the retired `sponsored_deep` pool, so a quote with such a hop built a transaction that aborts.
  - Read the E-Mode a Cap's lending account is actually in (`PositionAmounts.accountEmodeId`, read by the default data source for a strategy with `emodeId`). An `open` that reuses an empty Cap in no mode enters the configured mode before any lending call; a position outside that mode, or an empty Cap in another mode, is `POSITION_UNSUPPORTED` instead of being quoted with E-Mode risk parameters; a mode that changed after the quote is `STALE_QUOTE`. A custom data source that omits `accountEmodeId` behaves as before.
  - Leave supply outside the collateral reserve out of the position instead of failing with `POSITION_UNSUPPORTED`: anyone can deposit on behalf of a lending account. Debt outside the debt reserve is still refused.
  - Keep a target equal to `maxLeverage` reachable under the 0.1% target accuracy: above the target, the solver now accepts only results inside the `maxLeverage` ceiling band.
  - Keep the fees a converter quoted when `enrichFees` returns nothing.

## 0.3.0

### Minor Changes

- Remove the market-price path; quotes always use live oracle prices.

  - **Breaking:** remove `marketPriceMode` (client and data-source options), `MarketPriceMode`, `OraclePriceFreshness`, `MarketSnapshot.priceEvidence`, and the `marketOraclePrices` / `oracleDeploymentRevision` exports. `DataSource.readMarket(strategy)` no longer takes a mode. `MARKET_PRICE_EXPIRED` and `PRICE_DATA_UNAVAILABLE` are no longer raised. Measured on mainnet, cached oracle prices were minutes old (vSUI ~25 min, haSUI ~57 min), so the market path never qualified.
  - Start oracle preparation (Pyth staleness check, Pyth update when stale, `update_single_price_v2`) as soon as the market config is read, in parallel with the pool, flash-loan and E-Mode reads. Prices, feeds and the simulated PTB are unchanged. The `market_price_validate` and `market_risk_inspect` measure stages are gone; `market_oracle` now overlaps the other reads.

## 0.2.0

### Minor Changes

- Release the AccountCap-based Multiply SDK as stable 0.2.0.

  - Provide position reads, quotes and composable PTB construction for application-configured strategies. The SDK never signs or broadcasts transactions.
  - Bind positions to numeric strategy/version Registry keys, skip explicitly retired keys, and use v4 execution plans with explicit funding and conversion roles. Accept principal inputs from either configured pair asset and return remaining coins and collateral dust.
  - Initialize new strategy AccountCaps in their configured E-Mode without registering them in the separate E-Mode Registry. Legacy Cap migration is not included.
  - Use Astros for executable swap routes. Seed vSUI/haSUI amounts from staking exchange rates and other pairs from prices and fees, validate the candidate with a swap quote, and fall back to the existing solver when needed. Keep oracle updates inside the transaction PTB.
  - Allow 0.1% relative target accuracy for opening and increasing leverage; preserve stricter accuracy for other actions and all HF, LTV, maxLeverage, liquidity and funding checks. Keep risk-reducing actions available under the documented maxLeverage rules.
  - Use flash_loan_with_account_cap_v2 and flash_repay_with_account_cap with the strategy AccountCap for borrowing and repayment.
  - Handle native token precision, six-decimal collateral dust, minimum inputs, nonzero fees, repayment on negative equity and transient Cap binding failures.
  - Retain published dependencies @naviprotocol/lending 2.2.0 and @naviprotocol/astros-aggregator-sdk 2.0.7. Require Node.js 22+ and @mysten/sui >=2.20.2 <3.
