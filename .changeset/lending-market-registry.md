---
'@naviprotocol/lending': minor
---

Load the market list from open-api instead of relying only on the built-in `MARKETS`.

- New `loadMarketConfigs({ env })` fetches `/navi/markets` and stores the list per env; it never throws and falls back to the built-in list on failure.
- New `getMarketConfigs({ env })` (sync) and `registerMarketConfigs(configs, { env, authoritative })`.
- `getMarketConfig` now also resolves markets from loaded/registered lists, so a market added to open-api works without an SDK release. Known markets keep their built-in id and name.
- `getLendingState` and `getLendingPositions` enumerate the env's loaded list when `markets` is not passed; the reward batch and claim helpers look up pools across that list. `getUserAvailableLendingRewards` still defaults to the main market.
- The `/navi/markets` request is bounded (5s); a stall falls back to the current list.
