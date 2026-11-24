# Astros-only implementation and validation

Default execution now uses Astros; independent chain-rate hints only seed the original solver. No native cash gate is used by default. API integration and full evidence are in the local API review artifact:

`/private/tmp/multiply-sdk-api-20261124/docs/multiply/astros-only-implementation-20261124.md`

SDK: 499 tests pass; typecheck/lint/build pass. Three-strategy reference builds and HF/min-output rejection tests pass. No-update builds remain blocked by chain oracle freshness. No package was published or service deployed.

Read-only scripts: `e2e/astros-only-benchmark.mjs`, `e2e/astros-only-build.mjs`, `e2e/astros-seed-error.mjs`.
