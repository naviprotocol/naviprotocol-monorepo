---
'@naviprotocol/lending': minor
---

Register the HIGH / USDC isolated market (`high-usdc`, market id 10) in `MARKETS`. HIGH (Ember High Income) is the supply-only collateral asset and native USDC the debt asset. Deployed on stage_v2 (`env: 'dev'`) 2026-08-26; without this entry `getMarketConfig`/`getMarket` throw `Market not found` for id 10 even though the open-api serves its config.
