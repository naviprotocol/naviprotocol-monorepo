---
'@naviprotocol/lending': patch
---

Composite ratio price feeds: `OraclePriceFeed` gains an optional `ratioOracleId`, and `isRatioPriceFeed` is exported. A composite asset (e.g. vSUI priced at SUI/USD × `Crypto.VSUI/SUI.RR` after `oracle::set_composite`) lists its ratio feed under the asset's own oracle id, so `filterPriceFeeds` keeps it with the asset's own feed and `updateOraclePricesPTB` pushes both. Behaviour is unchanged for configs without ratio feeds; open-api serves them for `env: 'dev'` (stage_v2) from 2026-11-12.
