# @naviprotocol/astros-aggregator-sdk

## 1.14.2

### Patch Changes

- 06e4b66: Sync magma config to @magmaprotocol/magma-ts-sdk@1.1.1.

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

## 1.14.1

### Patch Changes

- 895543c: update turbos package

## 1.14.0

### Minor Changes

- Improve gas usage

## 1.13.1

### Patch Changes

- Fix user agent of the get slippage setting api call

## 1.13.0

### Minor Changes

- Update bluefin package id

## 1.12.0

### Minor Changes

- Fix Magma ALMM and add high price impact warning

## 1.11.0

### Minor Changes

- Update FlowX

## 1.10.0

### Minor Changes

- Improve setting option for slippage

## 1.9.1

### Patch Changes

- Update the version for getting quote

## 1.9.0

### Minor Changes

- Magma ALMM dex

## 1.8.0

### Minor Changes

- Adjust type for error report and update Haedal package id
- Move @mysten/sui to peer dependency

## 1.7.1

### Patch Changes

- Fix cetus and magma dex's

## 1.7.0

### Minor Changes

- FlowX dex

## 1.6.0

### Minor Changes

- Update denpendency version

## 1.5.0

### Minor Changes

- Positive slippage update

## 1.4.3

### Patch Changes

- Fix the amount value calculation

## 1.4.2

### Patch Changes

- Fix swap option usage

## 1.4.0

### Minor Changes

- Upgrade slippage check version

## 1.3.0

### Minor Changes

- Introduce positive slippage v3

## 1.2.0

### Minor Changes

- Revert feature

## 1.1.0

### Minor Changes

- eaf8462: Integrate FlowX sdk
