---
'@naviprotocol/astros-aggregator-sdk': patch
---

Sync magma config to @magmaprotocol/magma-ts-sdk@1.1.1.

Magma protocol shipped a new integrate package on 2025-12-04
(`0x4a9d6fb6f34ca8918756c2dfddf8f0a7fd5ef590bcffa6c03db24a6f10f42c5e`)
to bypass a deprecated `pool::split_fees` path in the legacy integrate
`0x7c369062...` that aborts in the b2a swap direction (e.g. SUI→USDC
fails while USDC→SUI succeeds on the same pool).

This patch updates the hardcoded magma addresses in `AggregatorConfig`
to match `@magmaprotocol/magma-ts-sdk@1.1.1` `sdkOptions`, so PTBs
built by `makeMAGMAPTB` / `makeMAGMAALMMPTB` target the new contracts:

- `magmaPublishedAt`: `0x4a35d3...` → `0x183af2adf115...` (CLMM clmm_pool.published_at)
- `magmaIntegratePublishedAt`: `0x7c369062...` → `0x4a9d6fb6f34c...` (integrate.published_at — split_fees fix)
- `magmaAlmmPackageId`: `0x17ec44d2...` → `0x532bf64e6f0b...` (almm_pool.package_id)
- `magmaAlmmPublishedAt`: `0xa8b3dbe6...` → `0x8800c3f7496a...` (almm_pool.published_at)
- `magmaAlmmFactory`: `0x29999aad...` → `0xedb456e93e42...` (almmConfig.factory)

`magmaPackageId` and `magmaConfigId` remain unchanged (type stub and
global config object are stable).
