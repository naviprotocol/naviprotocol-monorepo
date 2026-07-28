---
'@naviprotocol/lending': patch
---

Fix Pyth price feed updates on the v2 Core (gRPC) client: price table entries are plain dynamic fields, so they are now fetched via `getDynamicField` instead of `getDynamicObjectField`, whose `Wrapper<PriceIdentifier>` derivation resolved to a nonexistent object and aborted every price refresh ("failed to update pyth price feeds, msg: Object 0x...").
