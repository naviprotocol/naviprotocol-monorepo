---
'@naviprotocol/lending': minor
---

Register the hBTC isolated market (`hbtc-usdc`, market id 12) in `MARKETS`. hBTC (Hashi, Sui's native-BTC bridge) is the supply-only collateral asset and native USDC the debt asset. Deployed on stage_v2 (`env: 'dev'`) 2026-10-26; without this entry `getMarketConfig`/`getMarket` throw `Market not found` for id 12 even though the open-api serves its config.
