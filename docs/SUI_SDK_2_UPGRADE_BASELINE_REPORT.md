# Sui SDK 2.0 SDK Baseline Report

日期：2026-06-03

## Scope

本报告记录 `Sui SDK 2.0 SDK v2 beta delivery` 的 preflight baseline。
本轮只执行 SDK 升级；`copilot` 仅用于当前行为、依赖冲突和最终 SDK tarball 消费验收，不做前端实现。

## Router / Readiness

- scale: `autonomous-phase`
- route: `workflow-router` + Codex Goal + package phased execution
- spec gate: `spec-ready`，依据：
  - `docs/SUI_SDK_2_UPGRADE_TECHNICAL_PLAN.md`
  - `docs/SUI_SDK_2_UPGRADE_SDK_TECHNICAL_PLAN.md`
- risk gates:
  - build/typecheck/test/read-only smoke: no high-risk gate
  - funded sign/execute: high-risk; user granted test-wallet scope, but each real execute must remain authorized test wallet + small amount and must not print secrets
- required runtime:
  - SDK final verification: Node `v22.22.2`, pnpm `10.1.0`
  - current shell default also has Node `v23.11.0`; SDK commands must pin Node 22 via `PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH`

## Git State

### naviprotocol-monorepo

- branch: `feat/sui-sdk-v2`
- upstream: `origin/feat/sui-sdk-v2`
- ahead: 3 commits
- dirty state before implementation:
  - `?? docs/SUI_SDK_2_UPGRADE_SDK_TECHNICAL_PLAN.md`
  - `?? docs/SUI_SDK_2_UPGRADE_BASELINE_REPORT.md` (this report)

### copilot

- branch: `feat/mysten-sui-2.0`
- dirty state before SDK implementation:
  - `M pnpm-lock.yaml`

The pre-existing copilot lockfile change is not owned by this SDK task and must not be reverted.

## SDK Package Inventory

| Package | Baseline version | Build script | Test script | Test files |
| --- | --- | --- | --- | --- |
| `@naviprotocol/lending` | `1.4.6` | `run-p build:lib` -> `vite build` | `vitest --config ./vite.config.unit.js` | 10 files |
| `@naviprotocol/wallet-client` | `1.4.10` | `run-p build:lib` -> `vite build` | `vitest --config ./vite.config.unit.js` | 6 files |
| `@naviprotocol/astros-aggregator-sdk` | `1.14.2` | `run-p build:lib` -> `vite build` | `vitest --config ./vite.config.unit.js` | 1 file |
| `@naviprotocol/astros-bridge-sdk` | `1.2.1` | `run-p build:lib` -> `vite build` | `vitest --config ./vite.config.unit.js` | 1 file |
| `@naviprotocol/astros-dca-sdk` | `1.0.0` | `run-p build:lib` -> `vite build` | `vitest --config ./vite.config.unit.js` | none |

## SDK Dependency Baseline

Command:

```bash
pnpm why @mysten/sui @mysten/sui.js @pythnetwork/pyth-sui-js @mayanfinance/swap-sdk --recursive
```

Findings:

- All SDK target packages currently use `@mysten/sui@1.38.0` as dev/peer baseline.
- `@naviprotocol/lending` has `@pythnetwork/pyth-sui-js@2.2.0` in main dependencies.
- `@naviprotocol/wallet-client` pulls `@pythnetwork/pyth-sui-js@2.2.0` through lending and Suilend/7K/Cetus/FlowX dependency paths.
- `@naviprotocol/astros-bridge-sdk` has `@mayanfinance/swap-sdk@13.3.0` in main dependencies; Mayan pulls `@mysten/sui@1.38.0`.
- No SDK v2 main path can keep this dependency shape for final acceptance.

## SDK Baseline Commands

### Install

```bash
pnpm install --frozen-lockfile
```

Result: passed; lockfile was already up to date.

### Build / Typecheck On Node 22

Commands:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
```

Result:

- `@naviprotocol/lending`: build passed, typecheck passed.
- `@naviprotocol/wallet-client`: build passed, typecheck passed.
- `@naviprotocol/astros-aggregator-sdk`: build passed, typecheck passed.
- `@naviprotocol/astros-bridge-sdk`: build passed, typecheck passed.
- `@naviprotocol/astros-dca-sdk`: build passed, typecheck passed.

Common warning: Vite CJS Node API deprecation warning.

### Test Baseline

Commands:

```bash
pnpm --filter @naviprotocol/lending test
pnpm --filter @naviprotocol/wallet-client test
pnpm --filter @naviprotocol/astros-aggregator-sdk test
pnpm --filter @naviprotocol/astros-bridge-sdk test
pnpm --filter @naviprotocol/astros-dca-sdk test
```

Results:

| Package | Result | Baseline notes |
| --- | --- | --- |
| `@naviprotocol/lending` | failed | 68 passed / 17 failed / 85 total. Failures include config package-id drift, eMode/account-cap/repay dry-run failures, account coin dynamic/RPC failures, and reward history timeout. |
| `@naviprotocol/wallet-client` | failed | 6 suites failed during collection because `@suilend/sdk@1.1.75` requires missing `@sentry/nextjs`. No tests executed. |
| `@naviprotocol/astros-aggregator-sdk` | failed | Single active route test failed: production open aggregator `find_routes` returned HTTP 400 for DEEP -> SUI deepbook route. |
| `@naviprotocol/astros-bridge-sdk` | passed | 1 quote test passed. |
| `@naviprotocol/astros-dca-sdk` | failed | No test files found; Vitest exits with code 1. |

These failures are baseline failures and must be separated from v2 regression. The final v2 goal still requires package tests to pass or have explicit blocker records with impact and owner.

## Key SDK Business Paths

- lending:
  - read: config, markets, pools, account state, rewards, oracle prices, eMode, account caps
  - tx/PTB: deposit, withdraw, borrow, repay, flashloan, liquidate, claim rewards, eMode enter/exit/create cap
  - v2-specific: Core API reads, simulate returnValues parser, BCS golden parser, Pyth Hermes/update/stale-check builder
- wallet-client:
  - client factory, signer/executor, dry-run/execute wrappers
  - modules: balance, lending, swap, volo, haedal, lending migration
  - v2-specific: no raw v1 transaction response as public stable contract
- astros-aggregator-sdk:
  - quote, route build, swap PTB, service fee, shio auction execute path
  - v2-specific: route simulate parser and execute response normalization
- astros-bridge-sdk:
  - quote, Mayan swap/status, wallet connection execution
  - v2-specific: public bytes/DTO API, internal lazy Mayan v1 adapter, root entry must not load Mayan/Sui v1
- astros-dca-sdk:
  - create order, cancel order, coin selection, query orders
  - v2-specific: coin pagination/Core API and minimal create/cancel simulate smoke

## Copilot Baseline

### Install

Command:

```bash
pnpm install --frozen-lockfile
```

Result: passed; lockfile already up to date. Existing `pnpm-lock.yaml` remained dirty.

### Dependency Baseline

Command:

```bash
pnpm why @mysten/sui @mysten/sui.js @pythnetwork/pyth-sui-js @mayanfinance/swap-sdk --recursive
```

Findings:

- Main Sui v2 apps use `@mysten/sui@2.17.0`.
- Dynamic Labs packages still pull `@mysten/sui@1.24.0`.
- `apps/interface-console` still uses legacy Sui v1 and `@mysten/sui.js@0.54.1`.
- `@naviprotocol/lending@1.4.5-beta.4` pulls `@pythnetwork/pyth-sui-js@2.2.0`, which pulls `@mysten/sui@1.45.2`.
- `@naviprotocol/astros-aggregator-sdk@1.14.2-beta.1` is installed in frontend target apps but still imports v1 `SuiClient`.
- `packages/copilot-store` has third-party protocol SDKs with Sui v1/v2 conflicts: AlphaFi/7K/Cetus/FlowX/Pyth, Scallop, Magma, Haedal/Cetus family.
- `packages/swap-core` still has `@mysten/sui.js@0.54.1` through MSafe peer paths.

### Full Workspace Typecheck

Command:

```bash
pnpm typecheck:all
```

Result: failed.

Primary failure: `@naviprotocol/interface-console#typecheck` uses TypeScript 4.9 and fails to parse newer dependency declaration syntax from packages such as `@mysten/bcs` and `valibot`.

Targeted SDK consumer typechecks:

```bash
pnpm --filter @naviprotocol/lending-next typecheck
pnpm --filter @naviprotocol/astros typecheck
pnpm --filter @naviprotocol/astros-aggregator typecheck
pnpm --filter @naviprotocol/copilot-migrate typecheck
pnpm --filter @naviprotocol/copilot-store typecheck
pnpm --filter @naviprotocol/swap typecheck
```

Result: all passed.

### Full Workspace Build

Command:

```bash
pnpm build
```

Result: failed.

Primary failure before task implementation: `navi-year-in-review#build` imports `@naviprotocol/lending@1.4.5-beta.4`, whose built ESM imports v1 `SuiClient/getFullnodeUrl` from `@mysten/sui/client`; these exports do not exist in `@mysten/sui@2.17.0`.

### Targeted SDK Consumer Builds

Commands:

```bash
SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/lending-next build
SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
```

Results:

- `@naviprotocol/lending-next`: failed.
  - NAVI SDK conflict: `@naviprotocol/lending@1.4.5-beta.4` imports v1 `SuiClient/getFullnodeUrl` from `@mysten/sui@2.17.0`.
  - NAVI SDK conflict: `@naviprotocol/astros-aggregator-sdk@1.14.2-beta.1` imports v1 `SuiClient`.
  - Third-party conflicts: Cetus/Haedal/Magma/Scallop SDKs import v1 `SuiClient/getFullnodeUrl` or old `@mysten/sui/graphql/schemas/latest`.
- `@naviprotocol/astros`: failed.
  - `@naviprotocol/astros-aggregator-sdk@1.14.2-beta.1` imports v1 `SuiClient`.
  - `@naviprotocol/lending@1.4.5-beta.4` imports v1 `SuiClient/getFullnodeUrl`.
- `@naviprotocol/astros-aggregator`: failed.
  - `@naviprotocol/astros-aggregator-sdk@1.14.2-beta.1` imports v1 `SuiClient`.
  - `@naviprotocol/lending@1.4.5-beta.4` imports v1 `SuiClient/getFullnodeUrl`.

This baseline means SDK v2 tarball acceptance must at minimum remove the NAVI SDK `SuiClient/getFullnodeUrl` failures from target app builds. Remaining third-party copilot-store conflicts must be reported separately if they still block full `apps/lending` build.

## Web3 Test Wallet Readiness

Presence check only, no secrets printed:

- `FE_E2E_SUI_PRIVATE_KEY`: present in local secret catalog
- `FE_E2E_SUI_ADDRESS`: present in local secret catalog

Real sign/execute checks remain gated to authorized test wallet and small amount.

## Baseline Quality Contract

- scope: `naviprotocol-monorepo` SDK packages plus docs/examples/migration guide; `copilot` only baseline and final tarball consumer verification.
- explicit non-goals: no open-api implementation; no frontend implementation; no commit/push.
- logic boundaries: v2 client construction, Core API read paths, JSON-RPC adapter boundary, BCS parser, simulate returnValues, Pyth update builder, signer/execute result normalization, Bridge bytes/status.
- dependency boundaries: SDK v2 public path must not expose `@mysten/sui.js`, old `SuiClient`, old `TransactionBlock`, raw v1 responses, Pyth main dependency, or Mayan root import.
- verification: Node 22 build/typecheck/test by package; dependency tree checks; frontend tarball install/typecheck/build; funded small-amount Web3 smoke where required; blockers documented with impact/owner.

## Initial Blockers / Watch Items

- Baseline tests are not green; v2 implementation must either fix or explicitly classify remaining failures.
- `astros-dca-sdk` has no tests; final v2 must add minimal create/cancel/coin-utils/simulate tests.
- `wallet-client` test collection is blocked by missing `@sentry/nextjs` through old Suilend dependency.
- `copilot` target app builds currently fail because installed NAVI beta SDKs still import v1 `SuiClient/getFullnodeUrl`.
- `apps/lending` also fails on non-NAVI third-party protocol SDKs. If those remain after SDK tarball install, they must be treated as frontend/open-api/third-party blockers rather than hidden SDK success.

## SDK v2 Implementation Commits

| Commit | Type | Summary |
| --- | --- | --- |
| `be96426` | `feat` | Migrated target SDK packages to `2.0.0-beta.0`, moved direct SDK usage to `@mysten/sui@2.17.0`, added lending Sui v2 client factory and NAVI-owned Pyth v2 helper, and converted bridge/wallet/aggregator/dca client contracts to v2-compatible paths. |
| `d2d04b3` | `test` | Added Sui v2 migration coverage for lending Pyth Hermes/VAA helpers, bridge root lazy import, and DCA SUI/non-SUI create-order PTB paths; migrated existing target tests to v2 imports where needed. |
| `1644510` | `fix` | Lazy-loaded wallet Suilend protocol initialization so `wallet-client` root import no longer fails test collection because of Suilend dependency side effects. |
| `eb6f85f` | `test` | Added deterministic aggregator v2 PTB fixture coverage and moved the production DEEP -> SUI route test behind `NAVI_LIVE_TESTS=1`. |
| `d3123c9` | `test` | Split default unit gates from mainnet/API/RPC live smoke in lending and wallet-client tests; default package tests now avoid fixed-wallet balance and production-service flakiness. |

## Post-Migration SDK Verification

Runtime:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH
```

### Typecheck

Commands:

```bash
pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
```

Result: all five target SDK packages passed on Node 22.

### Build

Commands:

```bash
pnpm --filter @naviprotocol/lending build
pnpm --filter @naviprotocol/wallet-client build
pnpm --filter @naviprotocol/astros-aggregator-sdk build
pnpm --filter @naviprotocol/astros-bridge-sdk build
pnpm --filter @naviprotocol/astros-dca-sdk build
```

Result: all five target SDK packages passed on Node 22.

Common warning: Vite CJS Node API deprecation warning. This confirms package build output is still dual CJS/ESM and does not yet satisfy the strict ESM-only acceptance item.

### Added / Targeted Tests

Commands:

```bash
cd packages/lending && pnpm exec vitest --config ./vite.config.unit.js tests/pyth.test.ts
cd packages/astros-bridge-sdk && pnpm exec vitest --config ./vite.config.unit.js tests/lazy-root.test.ts
cd packages/astros-dca-sdk && pnpm exec vitest --config ./vite.config.unit.js tests/dca.test.ts
```

Results:

- `lending/tests/pyth.test.ts`: passed, 2 tests. Covers Hermes price id normalization and VAA base64 decoding.
- `astros-bridge-sdk/tests/lazy-root.test.ts`: passed, 1 test. Covers root import not loading the Mayan provider module.
- `astros-dca-sdk/tests/dca.test.ts`: passed, 2 tests. Covers SUI-funded create order and non-SUI merge/split coin PTB path.

### Full Package Tests

Commands:

```bash
pnpm --filter @naviprotocol/lending test
pnpm --filter @naviprotocol/wallet-client test
pnpm --filter @naviprotocol/astros-aggregator-sdk test
pnpm --filter @naviprotocol/astros-bridge-sdk test
pnpm --filter @naviprotocol/astros-dca-sdk test
```

Results:

| Package | Result | Baseline comparison / conclusion |
| --- | --- | --- |
| `@naviprotocol/lending@2.0.0-beta.0` | passed: 9 files passed / 2 skipped; 37 tests passed / 51 skipped | Default package test gate is now deterministic. Mainnet/API/RPC/fixed-wallet smoke is explicitly gated by `NAVI_LIVE_TESTS=1` and remains required for final business acceptance. |
| `@naviprotocol/wallet-client@2.0.0-beta.0` | passed: 1 file passed / 5 skipped; 1 test passed / 25 skipped | Default package test gate now verifies root/module load without triggering live wrappers. Lending/swap/haedal/volo/balance/migration wrappers remain `NAVI_LIVE_TESTS=1` smoke; Suilend path is still a v2 dependency blocker. |
| `@naviprotocol/astros-aggregator-sdk@2.0.0-beta.0` | passed: 2 tests passed / 1 skipped | Deterministic v2 PTB fixture tests pass. Production DEEP -> SUI deepbook route is `NAVI_LIVE_TESTS=1` smoke and no longer blocks default unit gate. |
| `@naviprotocol/astros-bridge-sdk@2.0.0-beta.0` | passed: 2 tests passed | Improved with added root lazy test. Does not yet cover v2 parse / dry-run / sign / execute / status in automated SDK regression. |
| `@naviprotocol/astros-dca-sdk@2.0.0-beta.0` | passed: 2 tests passed | Improved from baseline `No test files found` to 2 passing unit tests. Real simulate / execute smoke still pending. |

## Post-Migration Dependency Tree

Command:

```bash
pnpm why @mysten/sui @mysten/sui.js @pythnetwork/pyth-sui-js @mayanfinance/swap-sdk --recursive
```

Findings:

- `@naviprotocol/lending@2.0.0-beta.0`: direct dependency tree no longer contains `@pythnetwork/pyth-sui-js`; dev dependency uses `@mysten/sui@2.17.0`.
- `@naviprotocol/astros-aggregator-sdk@2.0.0-beta.0`: dev dependency uses `@mysten/sui@2.17.0`; no `@mysten/sui.js` on its package dependency path.
- `@naviprotocol/astros-dca-sdk@2.0.0-beta.0`: dev dependency uses `@mysten/sui@2.17.0`; no `@mysten/sui.js` on its package dependency path.
- `@naviprotocol/astros-bridge-sdk@2.0.0-beta.0`: `@mayanfinance/swap-sdk@13.3.0` still brings `@mysten/sui@1.38.0`. This is allowed only as an internal lazy adapter path; final frontend bundle check must prove it is absent from root and non-Bridge chunks.
- `@naviprotocol/wallet-client@2.0.0-beta.0`: `@suilend/sdk@1.1.75` pulls Sui v1-era transitive paths through `@7kprotocol/sdk-ts`, Cetus, FlowX, Pyth, and `@mysten/sui.js@0.54.1`. This is not acceptable for SDK v2 root/main path unless Suilend is isolated further, removed from root capability, or upgraded to a verified v2-safe dependency.
- `@naviprotocol/docs` still depends on `@naviprotocol/lending@1.3.10`, which pulls Sui v1 and Pyth. This is outside the target SDK package set but should be addressed before a full monorepo dependency audit is claimed green.

## Package Phase Evidence Summary

| Package | Migration content | Tests added/updated | Build/typecheck evidence | Current conclusion |
| --- | --- | --- | --- | --- |
| `@naviprotocol/lending@2` | v2 package metadata, Sui v2 JSON-RPC client factory, v2 BCS imports, removal of direct Pyth package dependency, NAVI-owned Pyth Hermes/update helper. | `tests/pyth.test.ts`; account-cap/eMode/config/oracle/reward/market deterministic tests; live mainnet/API/RPC smoke gated by `NAVI_LIVE_TESTS=1`. | Build passed; typecheck passed; default package tests passed. | Partial: default test gate accepted; Pyth dry-run/execute/on-chain smoke and live lending business smoke pending. |
| `@naviprotocol/wallet-client@2` | v2 package metadata, v2 client/transport typing, root import no longer eagerly loads Suilend. | Default module-load unit gate plus `NAVI_LIVE_TESTS=1` wrappers for balance/lending/swap/haedal/volo/migration. | Build passed; typecheck passed; default package tests passed. | Partial: default test gate accepted; Suilend protocol remains blocked by v1 transitive runtime; Web3 wrapper smoke pending. |
| `@naviprotocol/astros-bridge-sdk@2` | v2 package metadata/client typing; Mayan provider dynamic import from root `swap()` path. | `tests/lazy-root.test.ts`; existing quote test migrated. | Build passed; typecheck passed; full package tests passed. | Partial: root lazy evidence passed, but v2 parse/dry-run/sign/execute/status and frontend chunk checks pending. |
| `@naviprotocol/astros-aggregator-sdk@2` | v2 package metadata/client typing. | Deterministic v2 PTB fixture tests; production route smoke gated by `NAVI_LIVE_TESTS=1`. | Build passed; typecheck passed; default package tests passed. | Partial: default PTB gate accepted; live route/swap smoke pending. |
| `@naviprotocol/astros-dca-sdk@2` | v2 package metadata/client typing. | `tests/dca.test.ts`. | Build passed; typecheck passed; full package tests passed. | Partial: unit PTB coverage added; live simulate/execute smoke pending. |

## Current Acceptance Checklist Status

| Checklist item | Status | Evidence / blocker |
| --- | --- | --- |
| SDK baseline recorded | Done | This report. |
| Frontend baseline recorded | Done | This report, `Copilot Baseline`. |
| All SDK v2 package builds pass on Node 22 | Done | Five package build commands passed. |
| All SDK v2 package typechecks pass on Node 22 | Done | Five package `tsc --noEmit` commands passed. |
| Package tests pass or baseline failures separated | Done for default gate | Five target package default tests pass on Node 22. Live smoke is separated behind `NAVI_LIVE_TESTS=1` and remains final acceptance work. |
| `@mysten/sui.js` absent from SDK v2 main path | Blocked | Wallet Suilend/FlowX path still pulls `@mysten/sui.js@0.54.1`; needs isolation/removal/upgrade evidence. |
| No old `SuiClient` / `TransactionBlock` / raw v1 public contract | Partial | Target package source no longer imports v1 `@mysten/sui.js`; some public types still use concrete JSON-RPC client contracts instead of `ClientWithCoreApi`. Requires public API scan and possible typing cleanup. |
| Read/view accepts `ClientWithCoreApi` or equivalent | Partial | Current implementation uses `SuiJsonRpcClient` compatibility in several packages. Needs explicit adapter documentation or public contract refactor. |
| JSON-RPC only in explicit adapter / documented compatibility path | Partial | JSON-RPC usage is intentional for v2 compatibility but not yet centralized as `NaviJsonRpcAdapter`. Needs follow-up or recorded exception. |
| Lending main deps exclude `@pythnetwork/pyth-sui-js` | Done | `pnpm why` shows lending target package only has `@mysten/sui@2.17.0` as dev dependency. |
| Pyth v2 builder dry-run / real execute / chain query | Blocked | Unit helper coverage exists; funded smoke not yet run in this implementation pass. |
| Bridge Mayan build bytes / v2 parse / dry-run / sign / execute / status | Blocked | Design doc has prior manual smoke evidence; SDK regression and current package/tarball evidence not yet produced. |
| Bridge root entry lazy | Done for SDK root | `tests/lazy-root.test.ts` passed. |
| Bridge lazy chunk + frontend bundle | Pending | Requires frontend tarball install/build and chunk inspection. |
| Aggregator and DCA minimal PTB/simulate smoke | Partial | Aggregator and DCA deterministic PTB tests pass; live simulate smoke remains pending. |
| Docs/examples/migration guide | Done | `docs/SUI_SDK_2_UPGRADE_MIGRATION_GUIDE.md` added. |
| Frontend tarball install/typecheck/build | Pending | Not started after SDK package pass. |
| Frontend dependency conflict check | Pending | Baseline recorded; post-tarball check pending. |
| Authorized wallet main business flows | Pending | Not run in this implementation pass. |
| Unfinished items have blocker records | In progress | Current blockers recorded below; owner/decision still needed for some. |

## Blockers Requiring Decision Or Follow-Up

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| `wallet-client` Suilend dependency path is not v2-safe | Wallet wrapper package cannot satisfy no-v1-main-path and Suilend smoke checklist. | `pnpm why` shows Suilend -> 7K/Cetus/FlowX/Pyth -> Sui v1 / `@mysten/sui.js`; tests log `getFullnodeUrl is not a function` from 7K path. | SDK owner to choose: remove Suilend from `wallet-client@2` root capability, isolate into legacy lazy optional adapter, or upgrade/pin to a verified v2-safe Suilend stack. |
| Live lending smoke not yet accepted | Lending default package test passes, but business smoke is not complete. | `NAVI_LIVE_TESTS=1` tests include lending state, health factor, coin merge, pool PTB dry-run, rewards, flashloan, oracle stale checks. These were separated from the unit gate because they depend on fixed wallet state, RPC, and production APIs. | Run live smoke with authorized test wallet / stable fixtures, then either fix failures or record owner decisions. |
| Aggregator live route smoke is separated from unit gate | Aggregator default package test passes, but production route smoke is not complete. | DEEP -> SUI deepbook route test is now gated by `NAVI_LIVE_TESTS=1`; historical baseline saw open-aggregator HTTP 400/404. | SDK/API owner to run live route smoke or provide stable route fixture. |
| Strict ESM-only output is not implemented | Design doc strict acceptance still fails. | Package exports still expose `require` and builds emit `*.cjs.js`; Vite CJS warning appears. | Release owner to decide if beta can ship dual output for backward compatibility or require an ESM-only package export change. |
| Current frontend tarball acceptance not run | Cannot prove SDK is consumable by `copilot feat/mysten-sui-2.0`. | Pending. | Continue after SDK blockers are either fixed or explicitly accepted as blockers. |
| Real funded smoke not run in this pass | Pyth, Bridge, lending/swap/DCA/wallet wrappers checklist items remain incomplete. | Pending; secrets not printed. | Run with authorized test wallet and small amounts only after deterministic package gates are ready enough to avoid wasting transactions. |

## 2026-06-03 Tarball Consumer Acceptance Update

Additional commits:

| Commit | Type | Summary |
| --- | --- | --- |
| `8ce3b79` | `fix` | Aligned lending PTB coin argument and single-coin return types with Sui v2 transaction result behavior. |
| `a1764b2` | `test` | Added lending public API type-compat coverage for Sui v2 PTB consumer code and runtime `undefined` guard coverage. |
| `a869f87` | `fix` | Typed aggregator swap outputs as single-coin transaction results. |
| `be62685` | `test` | Added aggregator public API type-compat coverage for swap output reuse. |

SDK verification rerun on Node 22:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test:types
```

Results:

- Five SDK package typechecks passed.
- Five SDK package builds passed.
- Five SDK default package tests passed: lending `38 passed / 51 skipped`, wallet-client `1 passed / 25 skipped`, aggregator `2 passed / 1 skipped`, bridge `2 passed`, DCA `2 passed`.
- New public API type-compat gates passed for lending and aggregator. These compile against `dist/index.d.ts` with `noUncheckedIndexedAccess=true`.

Frontend tarball acceptance used a temporary detached copilot worktree at `/tmp/copilot-sdk-v2-acceptance` based on `feat/mysten-sui-2.0`. The real copilot worktree was not modified. The target SDK v2 tarballs were in `/tmp/navi-sdk-v2-packs`.

Install notes:

- Initial tarball install passed before the final lending/aggregator type fixes.
- After replacing same-name beta tarballs, `pnpm install --force` detected the expected tarball checksum change and began full monorepo resolution. It was terminated because registry retries for optional platform packages made it unsuitable for this acceptance loop.
- For final type/build verification, the temporary pnpm store package directories were overwritten from the refreshed tarball contents. This validates the actual packed SDK contents but is not a clean install proof. A clean install remains a final release gate.

Frontend targeted typecheck:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending-next typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-migrate typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-store typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/utils build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/storybook build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap typecheck
```

Result: targeted typecheck passed. The `packages/swap` typecheck requires building workspace config packages `@naviprotocol/utils` and `@naviprotocol/storybook` first because their exports point to `dist/*`.

Frontend targeted builds:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/lending-next build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap build
```

Results:

- `@naviprotocol/astros` build passed.
- `@naviprotocol/astros-aggregator` build passed.
- `@naviprotocol/swap` build passed.
- `@naviprotocol/lending-next` build failed during Turbopack production build. TypeScript passed first, then browser build failed on frontend third-party protocol SDKs that still import v1-era Sui exports from `@mysten/sui@2.17.0`: `SuiClient`, `getFullnodeUrl`, `fromB64`, `fromHEX`, plus `@mysten/sui/graphql/schemas/latest`. Import traces go through `packages/copilot-store/src/protocols/*` into Cetus, Magma, Scallop, and Haedal paths. Google Fonts network fetch also failed, but the Sui export errors are the material SDK-2 dependency blocker.

Bridge frontend bundle evidence:

```bash
rg -l "@mayanfinance|mayanfinance/swap-sdk|createSwapFromSuiMoveCalls|fetchQuote" apps/astros/.next apps/astros-aggregator/.next -g "*.js" -g "*.mjs"
node - <<'NODE'
const fs=require('fs');
for (const app of ['apps/astros','apps/astros-aggregator']) {
  const manifest=JSON.parse(fs.readFileSync(`${app}/.next/build-manifest.json`, 'utf8'));
  const target='static/chunks/0wsyr15w2751s.js';
  const routes=[];
  for (const [route, files] of Object.entries(manifest.pages||{})) {
    if (files.includes(target)) routes.push(route);
  }
  console.log(app, routes.join(', ') || '(no direct page manifest route)');
}
NODE
```

Result: Mayan SDK symbols appear in `static/chunks/0wsyr15w2751s.js` for both built apps. That chunk is not directly listed under any page entry in `build-manifest.json`, which supports the SDK lazy chunk direction. This is not yet a full browser multi-route smoke; `apps/lending` build remains blocked before the full target app chunk inspection can be completed.

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| Clean frontend install after refreshed same-name beta tarballs not completed | Final release cannot claim `pnpm install` green from a clean state. | `pnpm install --force` detected checksum change and began full resolution, then was terminated due optional package registry retries. Store overwrite from tarball was used only for type/build verification. | Release/FE owner to run clean install with a stable registry/cache or publish unique beta versions instead of overwriting same-name tarballs. |
| `apps/lending` build blocked by frontend third-party protocol SDKs under Sui v2 | Prevents full frontend build acceptance and authorized wallet smoke for lending/copilot routes. | Turbopack import traces show Cetus/Magma/Scallop/Haedal packages importing old `@mysten/sui/client` exports and old BCS helpers under `@mysten/sui@2.17.0`. | Frontend/open-api/protocol owner to isolate these protocols behind lazy/legacy boundaries, pin compatible versions, or disable affected copilot protocol imports for the SDK v2 frontend build gate. |
| Full Bridge multi-route browser smoke not completed | Bridge final checklist requires more than SDK root lazy unit test. | SDK root lazy test passed; astros builds passed; Mayan symbols were found only in an isolated static chunk not directly mapped to page entries. No browser route smoke or wallet execute was run. | Run browser smoke across root, swap, bridge list, bridge pair routes after target app build blocker is resolved. |
| Authorized wallet live business smoke not run | Lending, swap, bridge, DCA, wallet wrapper business acceptance remains incomplete. | Deterministic SDK and targeted frontend type/build evidence exists; real sign/execute was intentionally not attempted while `apps/lending` build is blocked. | Run with authorized test wallet and small amounts once frontend build can load target routes without third-party Sui v1/v2 conflicts. |

## 2026-06-03 ESM-only and Frontend Tarball Recheck

Additional commits:

| Commit | Type | Summary |
| --- | --- | --- |
| `f9fd38c` | `fix` | Switched SDK v2 packages to ESM-only package exports/build output and replaced wallet/aggregator public transaction returns with NAVI DTOs. |
| `d71d5ff` | `test` | Added wallet-client public transaction result type-compat coverage against built declarations. |

SDK verification rerun on Node 22:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test:types
```

Results:

- Five SDK package typechecks passed.
- Five SDK package builds passed and produced ESM artifacts only: `dist/index.esm.js` plus package-specific lazy chunks. No `*.cjs.js` artifacts were present after build.
- Five SDK default package tests passed: lending `38 passed / 51 skipped`, wallet-client `1 passed / 25 skipped`, aggregator `2 passed / 1 skipped`, bridge `2 passed`, DCA `2 passed`.
- Type-compat gates passed for lending, aggregator, and wallet-client. The wallet-client gate proves public module methods return `NaviWalletTransactionResult` DTOs and are not assignable to raw JSON-RPC response types.
- Public declaration scan found no `SuiTransactionBlockResponse`, `DryRunTransactionBlockResponse`, `TransactionBlock`, `@mysten/sui.js`, `index.cjs`, or package `require` export.

ESM-only package changes:

- Five SDK v2 packages now set `type: "module"`.
- Package `exports["."]` exposes `types` and `import` only; `require` was removed.
- Shared Vite library config now builds only `formats: ["es"]`.
- Package-local ESLint configs were renamed from `.eslintrc.js` to `.eslintrc.cjs` so `type: "module"` does not break lint hooks.

Packed ESM tarballs:

```bash
for pkg in packages/lending packages/wallet-client packages/astros-aggregator-sdk packages/astros-bridge-sdk packages/astros-dca-sdk; do
  (cd "$pkg" && PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm pack --pack-destination /tmp/navi-sdk-v2-packs-esm)
done
```

Generated:

- `/tmp/navi-sdk-v2-packs-esm/naviprotocol-lending-2.0.0-beta.0.tgz`
- `/tmp/navi-sdk-v2-packs-esm/naviprotocol-wallet-client-2.0.0-beta.0.tgz`
- `/tmp/navi-sdk-v2-packs-esm/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz`
- `/tmp/navi-sdk-v2-packs-esm/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz`
- `/tmp/navi-sdk-v2-packs-esm/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz`

Frontend tarball install and targeted verification used the temporary detached copilot worktree at `/tmp/copilot-sdk-v2-acceptance`; the real copilot worktree was not modified.

Frontend install:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --offline --ignore-scripts
```

Result: install passed against `/tmp/navi-sdk-v2-packs-esm` tarballs. The install still reports existing frontend peer/dependency conflicts, including Sui v1/v2 conflicts in `apps/lending`, `packages/copilot-migrate`, `packages/copilot-store`, and legacy interface-console paths.

Frontend targeted typecheck:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending-next typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-migrate typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-store typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/utils build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/storybook build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap typecheck
```

Result: targeted typecheck passed.

Frontend targeted builds:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/lending-next build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap build
```

Results:

- `@naviprotocol/astros` build passed after one retry. The first run reached static page generation and failed on `https://vault-api.volosui.com/api/v1/vaults?protocol=astros` with `ECONNRESET`; retry passed.
- `@naviprotocol/astros-aggregator` build passed.
- `@naviprotocol/swap` build passed.
- `@naviprotocol/lending-next` build failed during Turbopack production build after TypeScript passed. The blocking errors are still frontend third-party protocol SDKs importing exports removed from Sui SDK v2: `SuiClient`, `getFullnodeUrl`, `fromB64`, `fromHEX`, and `@mysten/sui/graphql/schemas/latest`. Import traces go through `packages/copilot-store/src/protocols/*` into Cetus, Magma, Scallop, and Haedal paths. Google Fonts network fetch also failed, but the Sui export errors are the material blocker.

Bridge frontend bundle evidence after ESM tarballs:

```bash
rg -l "@mayanfinance|mayanfinance/swap-sdk|createSwapFromSuiMoveCalls|fetchQuote" apps/astros/.next apps/astros-aggregator/.next -g "*.js" -g "*.mjs"
```

Result: Mayan SDK symbols appear only in `static/chunks/0wsyr15w2751s.js` for both `apps/astros` and `apps/astros-aggregator`. A `build-manifest.json` scan found no direct page manifest entries for that chunk.

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| `apps/lending` build blocked by frontend third-party protocol SDKs under Sui v2 | Prevents full frontend build acceptance and authorized wallet smoke for lending/copilot routes. | ESM tarball install and typecheck passed, then Turbopack failed on Cetus/Magma/Scallop/Haedal packages importing old `@mysten/sui/client` exports and old BCS helpers under `@mysten/sui@2.17.0`. | Frontend/open-api/protocol owner to isolate these protocols behind lazy/legacy boundaries, pin compatible versions, or disable affected copilot protocol imports for the SDK v2 frontend build gate. |
| Frontend dependency tree still has unacceptable Sui v1/v2 conflicts | Final frontend acceptance cannot be claimed even though SDK v2 tarballs install. | `pnpm install --offline --ignore-scripts` completed but reported Sui v1/v2 peer conflicts in `apps/lending`, `packages/copilot-migrate`, `packages/copilot-store`, and legacy `apps/interface-console` paths. | Frontend owner to remove or isolate legacy protocol SDKs from main v2 app paths. SDK owner can only keep SDK root packages v2-only/lazy. |
| Full Bridge multi-route browser smoke not completed | Bridge final checklist requires route-level runtime evidence, not only SDK root lazy unit and build-manifest evidence. | SDK root lazy test passed; `astros` and `astros-aggregator` builds passed; Mayan symbols are isolated to a non-page-manifest static chunk. No browser route smoke or wallet execute was run. | Run browser smoke across root, swap, bridge list, and bridge pair routes after final frontend target build is unblocked. |
| Authorized wallet live business smoke not run | Lending, swap, bridge, DCA, wallet wrapper business acceptance remains incomplete. | Deterministic SDK gates and targeted frontend type/build evidence exist; real sign/execute was not attempted while `apps/lending` build is blocked. | Run with authorized test wallet and small amounts once frontend build can load target routes without third-party Sui v1/v2 conflicts. |

## 2026-06-03 Docs and Migration Guide Type Coverage

Additional commits:

| Commit | Type | Summary |
| --- | --- | --- |
| `6cfda4d` | `test` | Added type-checked SDK v2 migration guide examples covering lending read/PTB, wallet dry-run DTOs, aggregator PTB, and DCA order builder. |
| `513e5c4` | `docs` | Added the Sui SDK v2 beta migration guide and updated related README/MDX examples for v2 clients, dry-run transaction examples, and DCA package imports. |

SDK migration guide type coverage:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test:types
```

Result: passed. The script now rebuilds `@naviprotocol/lending`, `@naviprotocol/astros-aggregator-sdk`, `@naviprotocol/astros-dca-sdk`, and `@naviprotocol/wallet-client` before `tsc --noEmit -p packages/wallet-client/tsconfig.type-tests.json`. The new `sdk-v2-migration-guide.ts` fixture proves the guide examples compile against built SDK v2 declarations.

Docs build coverage:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/docs build
```

Result: passed. TypeDoc emitted existing documentation warnings for omitted referenced types and README relative links; Next.js build compiled, typechecked, and generated 35 static pages. No new Sui SDK v2 compile error was introduced by the migration guide.

Docs formatting baseline:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/docs prettier
```

Result: failed on existing docs formatting debt across 32 files, including many files outside this SDK v2 change. The SDK v2 docs commit intentionally avoided broad formatting churn and kept edits scoped to relevant README/MDX content.

Current stop-condition status:

| Checklist area | Status | Evidence / blocker |
| --- | --- | --- |
| SDK package code, typecheck, build, and unit/type tests | Passed | All five SDK package gates are green in the earlier sections; migration guide examples now have an additional type gate. |
| Docs/examples/migration guide | Passed for SDK scope | `513e5c4` adds the v2 guide; docs build passes; docs prettier remains a pre-existing repo-wide formatting issue. |
| Frontend tarball consumer type/build acceptance | Partially passed | Tarball install and targeted typechecks passed; `astros`, `astros-aggregator`, and `swap` builds passed; `lending-next` build remains blocked by frontend third-party protocol SDKs importing Sui v1-era exports under Sui v2. |
| No unacceptable Sui v1/v2 dependency conflict in frontend | Blocked | Frontend install still reports Sui v1/v2 conflicts in app/store/protocol paths outside SDK ownership. |
| Authorized wallet business smoke | Blocked | Not run because the target frontend route build remains blocked. Requires frontend protocol dependency resolution before safe route-level wallet smoke. |
| Bridge multi-route browser smoke | Blocked | SDK root lazy test and bundle chunk evidence passed, but route-level browser smoke remains blocked until frontend target build is clean. |

## 2026-06-03 SDK Boundary Regression Scan

Additional commits:

| Commit | Type | Summary |
| --- | --- | --- |
| `a09fc26` | `fix` | Removed CommonJS `require("os")` from lending root ESM bundle and moved Bridge `WalletConnection` public type out of the internal Mayan provider. |
| `bf51564` | `test` | Added `pnpm test:sdk-v2-boundaries` to scan SDK v2 public declarations, package exports, root bundles, and Bridge Mayan lazy artifact placement. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- Lending tests passed: `39 passed / 51 skipped`; the new UA test verifies the user-agent helper no longer depends on CommonJS `require`.
- Lending build passed and `dist/index.esm.js` no longer contains `require()`.
- Bridge build and tests passed: `2 passed`; root `dist/index.d.ts` now imports `WalletConnection` from `./types`, not `./providers/mayan`.
- SDK v2 boundary scan passed. The scan checks all five SDK v2 package exports are ESM-only, public declarations do not contain `@mysten/sui.js`, old `TransactionBlock`, or raw v1 response types, root ESM bundles do not contain `require()`, and Mayan appears only in Bridge lazy provider/chunk artifacts.

Live smoke attempt:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 pnpm --filter @naviprotocol/lending test -- tests/oracle.test.ts tests/pool.test.ts tests/account.test.ts --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 pnpm exec vitest --config ./vite.config.unit.js tests/oracle.test.ts --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 pnpm exec vitest --config ./vite.config.unit.js tests/pool.test.ts --run -t "getPools|getStats|getFees|depositCoinPTB|withdrawCoinPTB|borrowCoinPTB|getBorrowFee"
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 pnpm exec vitest --config ./vite.config.unit.js tests/account.test.ts --run -t "getLendingState|getHealthFactor|getTransactions|getCoins"
```

Result: not accepted as green evidence. The broad run produced `79 passed / 10 failed`; failures were a mix of network instability (`ECONNRESET`, `ENOTFOUND fullnode.mainnet.sui.io`), chain-state-sensitive wallet fixtures (`repay`, insufficient balance), EMode registry lookup failures, and one claimed reward timeout. Narrow reruns still hit Sui RPC / NAVI API network errors. These attempts are useful blocker evidence but do not satisfy the funded wallet / live business smoke checklist.

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| Live SDK smoke is not deterministic with current public fixtures/RPC | Prevents claiming live lending/Pyth dry-run coverage as a stable gate. | `NAVI_LIVE_TESTS=1` lending smoke produced RPC resets, DNS failure, fixture balance failures, EMode registry lookup failures, and claimed reward timeout. | Add stable live-smoke fixtures with retryable RPC, funded/owned golden wallet state, and explicit skip/blocker semantics; or run against a controlled RPC and authorized wallet. |
| `apps/lending` build blocked by frontend third-party protocol SDKs under Sui v2 | Prevents full frontend build acceptance and authorized wallet smoke for lending/copilot routes. | ESM tarball install and typecheck passed, then Turbopack failed on Cetus/Magma/Scallop/Haedal packages importing old `@mysten/sui/client` exports and old BCS helpers under `@mysten/sui@2.17.0`. | Frontend/open-api/protocol owner to isolate these protocols behind lazy/legacy boundaries, pin compatible versions, or disable affected copilot protocol imports for the SDK v2 frontend build gate. |
| Frontend dependency tree still has unacceptable Sui v1/v2 conflicts | Final frontend acceptance cannot be claimed even though SDK v2 tarballs install. | `pnpm install --offline --ignore-scripts` completed but reported Sui v1/v2 peer conflicts in `apps/lending`, `packages/copilot-migrate`, `packages/copilot-store`, and legacy `apps/interface-console` paths. | Frontend owner to remove or isolate legacy protocol SDKs from main v2 app paths. |
| Full Bridge multi-route browser smoke not completed | Bridge final checklist requires route-level runtime evidence, not only SDK root lazy unit and build-manifest evidence. | SDK root lazy test, SDK boundary scan, and frontend bundle chunk scan passed; no browser multi-route smoke or wallet execute was run. | Run browser smoke across root, swap, bridge list, and bridge pair routes after final frontend target build is unblocked. |
| Authorized wallet live business smoke not run | Lending, swap, bridge, DCA, wallet wrapper business acceptance remains incomplete. | Deterministic SDK gates and targeted frontend type/build evidence exist; real sign/execute was not attempted while `apps/lending` build is blocked and live smoke fixtures are unstable. | Run with authorized test wallet and small amounts once frontend build can load target routes without third-party Sui v1/v2 conflicts. |

## 2026-06-03 Pyth and Bridge Adapter Regression Coverage

Additional commit:

| Commit | Type | Summary |
| --- | --- | --- |
| `f9682e6` | `test` | Added deterministic unit coverage for Pyth v2 PTB builder and Bridge Mayan Sui adapter sign/execute path. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- tests/pyth.test.ts --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- tests/mayan-provider.test.ts --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- Lending `tests/pyth.test.ts` passed. New `SuiPythClient` fixture covers dynamic Pyth/Wormhole package id resolution, base update fee lookup, price table dynamic field lookup, VAA parse command, authenticated price info command, `update_single_price_feed`, and hot-potato destroy command. This is deterministic PTB builder coverage; it does not replace the funded Pyth execute checklist item.
- Lending default tests passed: `40 passed / 51 skipped`.
- Bridge Mayan provider test passed. The Sui adapter path now has deterministic coverage for Mayan build call, v2 wallet `signTransaction`, v2 `executeTransactionBlock`, and `waitForTransaction`.
- Bridge default tests passed: `3 passed`.
- Lending and Bridge typechecks/builds passed.
- SDK v2 boundary scan still passed after the new adapter tests.

Remaining gap: Pyth real funded execute and Bridge real multi-route sign/execute/status are still not complete. They remain blocked by unstable live fixtures/RPC and by the frontend target build/dependency blockers recorded above.
