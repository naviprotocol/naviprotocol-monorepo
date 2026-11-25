---
'@naviprotocol/multiply': patch
---

Fix problems found by a review of the 0.2.0 / 0.3.0 code, each reproduced first (mainnet read-only simulation or a unit test).

- Depend on `@naviprotocol/astros-aggregator-sdk` 2.0.9. 2.0.7 routed DeepBook hops through the retired `sponsored_deep` pool, so a quote with such a hop built a transaction that aborts.
- Read the E-Mode a Cap's lending account is actually in (`PositionAmounts.accountEmodeId`, read by the default data source for a strategy with `emodeId`). An `open` that reuses an empty Cap in no mode enters the configured mode before any lending call; a position outside that mode, or an empty Cap in another mode, is `POSITION_UNSUPPORTED` instead of being quoted with E-Mode risk parameters; a mode that changed after the quote is `STALE_QUOTE`. A custom data source that omits `accountEmodeId` behaves as before.
- Leave supply outside the collateral reserve out of the position instead of failing with `POSITION_UNSUPPORTED`: anyone can deposit on behalf of a lending account. Debt outside the debt reserve is still refused.
- Keep a target equal to `maxLeverage` reachable under the 0.1% target accuracy: above the target, the solver now accepts only results inside the `maxLeverage` ceiling band.
- Keep the fees a converter quoted when `enrichFees` returns nothing.
