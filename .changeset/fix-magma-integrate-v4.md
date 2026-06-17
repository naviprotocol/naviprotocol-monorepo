---
"@naviprotocol/astros-aggregator-sdk": patch
---

fix(aggregator-sdk): update magma integrate package to on-chain v4

Magma upgraded its on-chain GlobalConfig.package_version to 4 and enforces it via
config::checked_package_version. The previous integrate package (0x4a9d6fb6, synced from
@magmaprotocol/magma-ts-sdk@1.1.1) is pre-v4, so router::swap aborted with code 10 on real
swaps (preswap was unaffected, masking the issue). Point magmaIntegratePublishedAt at the
current v4 integrate package 0x668909f9. Verified via devInspect: SUI->USDC and USDC->SUI
both succeed.
