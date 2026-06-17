---
"@naviprotocol/astros-aggregator-sdk": patch
---

fix(aggregator-sdk): bump find_routes version 13 -> 14 for magma v4 gating

Pairs with the magma v4 integrate package fix. The router API gates magma routes behind a
minimum client version; bumping the request version to 14 lets the backend return magma only
to clients running this (fixed) SDK, while older clients keep getting magma-free routes.
