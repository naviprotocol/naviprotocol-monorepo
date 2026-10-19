---
'@naviprotocol/lending': minor
---

Register the Ember Earn isolated market (`eearn-usdc`, market id 11) in `MARKETS`. eEARN (Ember Earn vault share) is the supply-only collateral asset and native USDC the debt asset. Deployed on stage_v2 (`env: 'dev'`) 2026-10-19; without this entry `getMarketConfig`/`getMarket` throw `Market not found` for id 11 even though the open-api serves its config.
