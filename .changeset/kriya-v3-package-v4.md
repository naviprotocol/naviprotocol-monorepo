---
"@naviprotocol/astros-aggregator-sdk": patch
---

fix(astros-sdk): bump Kriya V3 package to on-chain v4

Kriya upgraded its published package to v4; the stale v2 id makes
`trade::flash_swap` abort 69 (`assert_supported_version`) on mainnet
swaps routed through Kriya V3. Point `kriyaV3PackageId` at the current
on-chain v4 (`0x0d7305a7…`). `kriyaV3Version` (shared version registry
object) is unchanged.
