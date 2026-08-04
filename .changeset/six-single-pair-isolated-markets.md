---
'@naviprotocol/lending': minor
---

Register the six single-pair isolated markets that went live on mainnet 2026-08-03 in `MARKETS`: `sui-usdc` (4), `wbtc-usdc` (5, LayerZero WBTC), `xbtc-usdc` (6), `vsui-usdc` (7), `vsui-sui` (8) and `hasui-sui` (9). Each is one collateral asset (supply-only) plus one debt asset (borrow-only). Without these entries `getMarketConfig`/`getMarket` threw `Market not found` for ids 4-9, and consumers filtering on `MARKETS` dropped the markets entirely even though the open-api already served their config.
