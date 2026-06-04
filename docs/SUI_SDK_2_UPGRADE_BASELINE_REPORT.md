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

## 2026-06-03 Aggregator and DCA PTB/DTO Regression Coverage

Additional commit:

| Commit | Type | Summary |
| --- | --- | --- |
| `1df55f9` | `test` | Added deterministic aggregator execute DTO coverage and DCA cancel / coin utility PTB coverage. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- Aggregator tests passed: `3 passed / 1 skipped`. New coverage proves `executeTransaction` returns the NAVI DTO shape with `digest`, `effects`, `events`, `balanceChanges`, and `objectChanges`, and still executes the v2 transaction path even if Shio auction submission fails.
- DCA tests passed: `6 passed`. New coverage adds paginated coin fetching, insufficient-balance failure, cancel PTB creation, returned input coin transfer, and missing receipt validation.
- Aggregator and DCA typechecks/builds passed.
- Aggregator type-compat gate and wallet-client migration guide type gate passed after rebuilding dependent SDK packages.
- SDK v2 boundary scan still passed.

Remaining gap: aggregator/DCA deterministic PTB and DTO coverage is now materially stronger, but real frontend swap/DCA wallet smoke remains blocked by frontend build/dependency issues and requires authorized wallet execution after those blockers are resolved.

## 2026-06-03 Latest Tarball Frontend Acceptance Recheck

Latest packed SDK v2 tarballs:

```text
/tmp/navi-sdk-v2-packs-20260603193327/naviprotocol-lending-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603193327/naviprotocol-wallet-client-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603193327/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603193327/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603193327/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz
```

Frontend acceptance used the temporary detached copilot worktree at `/tmp/copilot-sdk-v2-acceptance`, with root `pnpm.overrides` pointed at the latest tarball directory. The real `copilot` worktree was not modified.

Install verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --ignore-scripts
```

Result: install passed. The install still reports unacceptable frontend Sui v1/v2 dependency conflicts outside SDK ownership, including:

- `apps/lending`: `@msafe/sui-app-store`, Suilend, Scallop, Firefly, Suiet, and related protocol/wallet packages still pull or peer against old Sui SDK shapes.
- `packages/copilot-migrate`: wallet-client/Suilend transitive dependencies and aggregator protocol packages still report old Sui peer ranges while the workspace consumes `@mysten/sui@2.17.0`.
- `packages/copilot-store`: Suilend, AlphaFi, 7K, Bluefin7K, Magma, MMT, Scallop, Aftermath, and related protocol packages still report old Sui peer ranges or import paths.
- legacy `apps/interface-console`: old dapp-kit/Sui dependency paths remain present.

Targeted frontend typecheck:

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

Result: all targeted typecheck/build prerequisites passed.

Targeted frontend build:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/lending-next build
```

Results:

- `@naviprotocol/astros` build passed.
- `@naviprotocol/astros-aggregator` build passed.
- `@naviprotocol/swap` build passed.
- `@naviprotocol/lending-next` build failed during Turbopack production build after TypeScript passed. The material failures remain frontend third-party protocol SDK imports incompatible with Sui SDK v2: `SuiClient`, `getFullnodeUrl`, `fromB64`, `fromHEX`, and `@mysten/sui/graphql/schemas/latest`. Import traces go through `packages/copilot-store/src/protocols/*` into Cetus, Magma, Scallop, and Haedal paths. Google Fonts network fetch also failed, but the Sui export errors are the release-blocking dependency issue.

Bridge frontend lazy evidence:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH rg -l "@mayanfinance|mayanfinance/swap-sdk|createSwapFromSuiMoveCalls|fetchQuote" apps/astros/.next apps/astros-aggregator/.next -g "*.js" -g "*.mjs"
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH node - <<'NODE'
const fs = require('fs');
for (const app of ['apps/astros', 'apps/astros-aggregator']) {
  const manifest = JSON.parse(fs.readFileSync(`${app}/.next/build-manifest.json`, 'utf8'));
  const hits = [];
  for (const [route, files] of Object.entries(manifest.pages || {})) {
    for (const file of files) {
      if (/0wsyr|mayan|bridge/i.test(file)) hits.push([route, file]);
    }
  }
  console.log(`${app}: ${hits.length ? JSON.stringify(hits) : 'no page-manifest Mayan/lazy chunk hit'}`);
}
NODE
```

Results:

- Mayan symbols were found only in `apps/astros/.next/static/chunks/0wsyr15w2751s.js` and `apps/astros-aggregator/.next/static/chunks/0wsyr15w2751s.js`.
- `build-manifest.json` had no Mayan/lazy chunk hits for direct page entries in either app.

Bridge / route smoke:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec next start -p 4010
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH node - <<'NODE'
const routes = ['/', '/swap/SUI-USDC', '/bridge/sui-solana', '/dca/SUI-USDC'];
for (const route of routes) {
  const res = await fetch(`http://localhost:4010${route}`, { redirect: 'manual' });
  console.log(`${route} ${res.status} ${res.headers.get('content-type') || ''}`);
}
NODE
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec next start -p 4011
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH node - <<'NODE'
const routes = ['/', '/swap/SUI-USDC', '/bridge/sui-solana', '/dca/SUI-USDC'];
for (const route of routes) {
  const res = await fetch(`http://localhost:4011${route}`, { redirect: 'manual' });
  console.log(`${route} ${res.status} ${res.headers.get('content-type') || ''}`);
}
NODE
```

Results:

- `apps/astros`: `/` returned `307`; `/swap/SUI-USDC`, `/bridge/sui-solana`, and `/dca/SUI-USDC` returned `200 text/html`.
- `apps/astros-aggregator`: `/` returned `307`; `/swap/SUI-USDC`, `/bridge/sui-solana`, and `/dca/SUI-USDC` returned `200 text/html`.
- This satisfies route-level HTTP smoke for built Astros consumers. It does not satisfy authorized wallet sign/execute smoke.

Current acceptance conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Latest SDK v2 tarballs can be installed by Copilot | Passed with warnings | `pnpm install --ignore-scripts` passed in `/tmp/copilot-sdk-v2-acceptance`; peer warnings still expose frontend-owned Sui v1/v2 conflicts. |
| Targeted frontend typecheck | Passed | lending-next, astros, astros-aggregator, copilot-migrate, copilot-store, and swap typechecks/build prerequisites passed. |
| Targeted frontend build | Partially passed | astros, astros-aggregator, and swap passed; lending-next failed on frontend third-party Sui v1/v2 protocol SDK imports after TypeScript passed. |
| Bridge root/lazy/frontend route smoke | Partially passed | SDK root lazy tests, frontend chunk scan, manifest scan, and multi-route HTTP smoke passed for astros and astros-aggregator; wallet sign/execute/status remains unverified. |
| No unacceptable frontend Sui v1/v2 dependency conflict | Blocked | Clean install still reports old Sui peer/import paths in frontend protocol and wallet dependencies outside SDK scope. |
| Authorized wallet business smoke | Blocked | Not run because full frontend acceptance remains blocked by `apps/lending` build/dependency conflicts and live SDK smoke fixtures/RPC remain unstable. |

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| `apps/lending` production build is blocked by frontend third-party protocol SDKs under Sui v2 | Prevents full frontend build acceptance and route-level lending/copilot wallet smoke. | Latest tarball install and typecheck passed, then Turbopack failed on Cetus/Magma/Scallop/Haedal packages importing old Sui v1-era exports under `@mysten/sui@2.17.0`. | Frontend/open-api/protocol owner to isolate or upgrade affected protocol SDKs, pin compatible versions, or disable affected copilot protocol imports for the SDK v2 frontend gate. |
| Frontend dependency tree still has unacceptable Sui v1/v2 conflicts | Final acceptance cannot claim a clean v2 dependency graph. | Latest `pnpm install --ignore-scripts` passed but reported conflicts in `apps/lending`, `packages/copilot-migrate`, `packages/copilot-store`, and legacy `apps/interface-console` paths. | Frontend owner to remove or isolate legacy Sui v1 protocol/wallet paths from v2 acceptance targets. |
| Authorized wallet live business smoke not run | Lending, swap, bridge, DCA, and wallet-wrapper business acceptance remains incomplete. | Deterministic SDK tests, frontend targeted typecheck/build, chunk scan, and HTTP smoke evidence exist; real sign/execute was not attempted while frontend build and dependency graph are blocked. | Run with authorized test wallet and small amounts after frontend target routes can build and load without v1/v2 dependency conflicts. |
| Live SDK smoke is not deterministic with current public fixtures/RPC | Prevents using existing `NAVI_LIVE_TESTS=1` suite as a stable green release gate. | Earlier live smoke attempts hit RPC resets, DNS failure, chain-state fixture failures, EMode registry lookup failure, and reward timeout. | Provide controlled RPC and funded/owned golden-wallet fixtures or accept these as external live-smoke blockers for beta. |

## 2026-06-03 Wallet Suilend Main-Path Isolation

Additional commits in this slice are split by change type:

| Type | Summary |
| --- | --- |
| `fix` | Move `@suilend/sdk` and `@suilend/sui-fe` out of `wallet-client` production dependencies, keep them as dev-only build inputs and optional peers, and gate the legacy Suilend adapter behind `configs.lending.enableSuilend`. |
| `test` | Add a wallet-client protocol registry test proving default initialization only registers NAVI and does not auto-load the legacy Suilend adapter. Extend `test:sdk-v2-boundaries` to fail if wallet-client reintroduces Suilend as a production dependency. |
| `docs` | Document the optional legacy Suilend adapter and its v2 dependency risk in the wallet-client README. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --ignore-scripts
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mysten/sui.js --filter @naviprotocol/wallet-client --prod
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @suilend/sdk --filter @naviprotocol/wallet-client --prod
```

Results:

- Wallet-client tests passed: `2 passed / 25 skipped`. The new default protocol registry test passed and proves Suilend is not auto-loaded unless explicitly enabled.
- Wallet-client typecheck, build, and type-compat tests passed.
- SDK v2 boundary scan passed and now enforces that `wallet-client` cannot reintroduce `@suilend/sdk` / `@suilend/sui-fe` as production dependencies.
- `pnpm why @mysten/sui.js --filter @naviprotocol/wallet-client --prod` produced no dependency path.
- `pnpm why @suilend/sdk --filter @naviprotocol/wallet-client --prod` produced no dependency path.
- `pnpm pack` for `packages/wallet-client` produced `/tmp/navi-wallet-client-suilend-check/naviprotocol-wallet-client-2.0.0-beta.0.tgz`; the packed `package.json` production `dependencies` contain NAVI lending/aggregator, axios, bignumber.js, date-fns, mitt, and shio-sdk only. Suilend packages appear only as optional peers.

Updated SDK-side conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| `@mysten/sui.js` absent from SDK v2 main path | Passed for wallet-client production path | Suilend is no longer a production dependency; `pnpm why --prod` has no `@mysten/sui.js` path for wallet-client. |
| Suilend wrapper smoke | Blocked / legacy optional | Suilend auto-init is disabled by default because the available stack still has Sui v1 peer/import risk. Users must explicitly install optional peers and set `configs.lending.enableSuilend=true`. |
| Frontend dependency conflict check | Still blocked outside SDK package | Copilot still has separate third-party Sui v1/v2 conflicts under `packages/copilot-store` and legacy app paths, independent of wallet-client's default production dependency graph. |

### Latest frontend install after wallet-client Suilend isolation

Latest packed SDK v2 tarballs:

```text
/tmp/navi-sdk-v2-packs-20260603195445/naviprotocol-lending-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603195445/naviprotocol-wallet-client-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603195445/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603195445/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603195445/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz
```

Frontend install recheck in `/tmp/copilot-sdk-v2-acceptance`:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --ignore-scripts
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @suilend/sdk --filter @naviprotocol/copilot-migrate
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @suilend/sdk --filter @naviprotocol/lending-next
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mysten/sui.js --filter @naviprotocol/copilot-migrate
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/wallet-client --filter @naviprotocol/copilot-migrate
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/wallet-client --filter @naviprotocol/lending-next
```

Results:

- Install passed against `/tmp/navi-sdk-v2-packs-20260603195445`.
- `@naviprotocol/copilot-migrate` and `@naviprotocol/lending-next` still consume `@naviprotocol/wallet-client@2.0.0-beta.0`.
- `@suilend/sdk` no longer comes from `@naviprotocol/wallet-client`; remaining paths are `packages/copilot-store -> @suilend/sdk@1.1.99` and `apps/lending -> @msafe/sui-app-store -> @suilend/sdk@1.1.98`.
- `@mysten/sui.js@0.54.1` for `@naviprotocol/copilot-migrate` now traces through `packages/copilot-store` dependencies: AlphaFi/7K/FlowX, Suilend/FlowX, and Haedal farm SDK.
- Conclusion: wallet-client no longer contributes the Suilend / `@mysten/sui.js` production conflict to frontend consumers. Remaining frontend dependency conflicts are owned by Copilot protocol/store and legacy app dependencies.

## 2026-06-03 Aggregator and DCA Dry-Run DTO Coverage

Additional commits in this slice are split by change type:

| Commit type | Summary |
| --- | --- |
| `feat` | Added `dryRunSwapTransaction` for `@naviprotocol/astros-aggregator-sdk@2` and `dryRunDcaTransaction` for `@naviprotocol/astros-dca-sdk@2`. Both helpers build v2 `Transaction` bytes, call `dryRunTransactionBlock`, and return NAVI DTOs instead of raw JSON-RPC response contracts. |
| `test` | Added deterministic dry-run normalization tests for aggregator swap PTB, DCA create PTB, and DCA cancel PTB. Added aggregator type-compat coverage proving the dry-run helper does not expose raw `DryRunTransactionBlockResponse`. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- Aggregator tests passed: `4 passed / 1 skipped`. Coverage now includes deterministic swap PTB build, inconsistent route rejection, execute DTO normalization, and dry-run DTO normalization.
- DCA tests passed: `8 passed`. Coverage now includes SUI and non-SUI create PTB, paginated coin fetching, insufficient-balance failure, cancel PTB, missing receipt validation, create dry-run DTO normalization, and cancel dry-run DTO normalization.
- Aggregator and DCA typechecks and builds passed.
- Aggregator type-compat test passed; `dryRunSwapTransaction` returns `NaviAggregatorDryRunResult` and is intentionally not assignable to raw `DryRunTransactionBlockResponse`.
- SDK v2 boundary scan passed after the new helpers.

Updated SDK-side conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Aggregator minimal PTB / simulate smoke | Passed for deterministic SDK gate | Swap PTB, execute DTO, and dry-run DTO helper are covered by unit and type-compat tests. Live frontend swap execute remains blocked by frontend dependency/build gates. |
| DCA minimal PTB / simulate smoke | Passed for deterministic SDK gate | Create/cancel PTBs and dry-run DTO helper are covered by unit tests. Live DCA execute remains blocked until frontend target routes are clean and authorized wallet smoke is run. |

## 2026-06-03 Bridge API DTO Boundary Coverage

Additional commit in this slice is split by change type:

| Commit type | Summary |
| --- | --- |
| `test` | Added deterministic Bridge root `swap()` DTO coverage and replaced the placeholder quote test with axios-adapter tests for quote request params, string chain-id normalization, transaction status lookup, and wallet history status mapping. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- Bridge tests passed: `4 files passed / 5 tests passed`.
- Bridge typecheck passed.
- Bridge build passed and kept separate lazy artifacts: `dist/index.esm.js` plus `dist/mayan-CKpVZNpu.js`.
- SDK v2 boundary scan passed after the new tests.
- Commit: `5870f65 test: cover bridge api dto boundaries`.

Updated SDK-side conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Bridge quote/status DTO API | Passed for deterministic SDK gate | Quote params, chain-id normalization, transaction lookup, and wallet history mapping are now unit-tested without live network. |
| Bridge root `swap()` DTO | Passed for deterministic SDK gate | Root `swap()` lazy-loads the Mayan provider mock and returns a processing `BridgeSwapTransaction` DTO with provider/hash/token/amount/status fields. |
| Bridge Mayan Sui sign/execute path | Passed for deterministic SDK gate | Existing Mayan provider test covers v2 `signTransaction`, `executeTransactionBlock`, and `waitForTransaction`; still not a real funded execute. |
| Bridge live wallet execute/status | Blocked | Authorized wallet bridge execute/status remains unverified until frontend dependency/build blockers are cleared and a small-amount test route can be run safely. |

## 2026-06-03 Docs and Examples Typecheck

Additional commits in this slice are split by change type:

| Commit type | Summary |
| --- | --- |
| `feat` | Exported lending v2 public helper APIs from root entry: `createNaviSuiClient`, `NaviSuiClient`, `SuiPriceServiceConnection`, and `SuiPythClient`. Added lending type-compat coverage so migration-guide imports stay valid. |
| `docs` | Updated the migration guide for current SDK v2 API shape and added `docs/examples/sdk-v2-smoke.ts` plus a dedicated example tsconfig. |

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test:types
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p docs/examples/tsconfig.json
```

Results:

- Lending type-compat, typecheck, and build passed after the new root exports.
- SDK v2 boundary scan passed after exposing the helper APIs.
- Docs example typecheck passed and covers v2 imports for lending/Pyth helper, wallet-client default path, aggregator dry-run DTO, Bridge quote/swap/status DTOs, and DCA create/cancel dry-run helpers.
- Code commit: `cbc4054 feat: export lending v2 helper APIs`.

Updated SDK-side conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| docs / examples / migration guide | Passed for SDK-controlled docs gate | Migration guide now matches current public API and `docs/examples/sdk-v2-smoke.ts` typechecks. |
| Lending v2 helper public API | Passed | Root package now exports v2 client/Pyth helper APIs used by the migration guide; type-compat test locks the imports. |
| Final frontend / wallet acceptance | Still blocked | Docs are current, but full Copilot build/dependency acceptance and authorized wallet business smokes remain incomplete as recorded above. |

## 2026-06-03 Latest SDK Gate and Tarball Recheck

Additional commit in this slice is split by change type:

| Commit type | Summary |
| --- | --- |
| `test` | Mocked aggregator positive-slippage remote config in the deterministic PTB fixture test so the default package test gate no longer depends on `open-api.naviprotocol.io`. |

Latest deterministic SDK verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending --filter @naviprotocol/wallet-client --filter @naviprotocol/astros-aggregator-sdk --filter @naviprotocol/astros-bridge-sdk --filter @naviprotocol/astros-dca-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/lending/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/wallet-client/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-aggregator-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-bridge-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p packages/astros-dca-sdk/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec tsc --noEmit -p docs/examples/tsconfig.json
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/wallet-client test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk test -- --run
```

Results:

- All five SDK package builds passed on Node `v22.22.2`.
- All five SDK package typechecks passed.
- SDK v2 boundary scan passed.
- Docs example typecheck passed.
- Default package tests passed:
  - lending: `10 files passed / 2 skipped`; `40 passed / 51 skipped`.
  - wallet-client: `2 files passed / 5 skipped`; `2 passed / 25 skipped`.
  - astros-aggregator-sdk: `1 file passed`; `4 passed / 1 skipped`.
  - astros-bridge-sdk: `4 files passed`; `5 passed`.
  - astros-dca-sdk: `1 file passed`; `8 passed`.
- Code commit: `242d970 test: keep aggregator ptb fixture offline`.

Latest SDK v2 tarballs:

```text
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-lending-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-wallet-client-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz
```

Frontend tarball recheck attempt in `/tmp/copilot-sdk-v2-acceptance`:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm add -w @naviprotocol/lending@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-lending-2.0.0-beta.0.tgz @naviprotocol/wallet-client@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-wallet-client-2.0.0-beta.0.tgz @naviprotocol/astros-aggregator-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz @naviprotocol/astros-bridge-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz @naviprotocol/astros-dca-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz --ignore-scripts
```

Result: blocked by registry/network failures before install completed. Two attempts failed with `ERR_SOCKET_TIMEOUT` / `ECONNRESET` while fetching Solana/Reown dependency metadata from npm registry, including `@solana/rpc-types`, `@solana/rpc-transformers`, `@solana/buffer-layout`, `bs58`, `js-sha3`, and `superstruct`. The reported dependency chain starts at Copilot `packages/uikit` through `@mysten/walletconnect-wallet@1.0.4 -> @reown/appkit -> @base-org/account -> @coinbase/cdp-sdk -> @solana/kit`.

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| Latest Copilot tarball install could not complete due registry network failures | Prevents producing a fresh frontend install/typecheck/build result for `/tmp/navi-sdk-v2-packs-20260603202116` in this pass. | Two `pnpm add -w ... --ignore-scripts` attempts failed on npm registry `ECONNRESET` / `ERR_SOCKET_TIMEOUT` for Solana/Reown dependency metadata under Copilot `packages/uikit`. | Retry when registry/network is stable or use a warmed pnpm store/internal registry mirror. |
| Full frontend acceptance remains blocked by previously recorded app/dependency issues | Final checklist still cannot be marked complete. | Earlier latest successful tarball install (`/tmp/navi-sdk-v2-packs-20260603195445`) showed SDK consumer install/typecheck progress but `apps/lending` build and dependency tree remained blocked by frontend third-party Sui v1/v2 conflicts. | Frontend/protocol owner to isolate or upgrade Copilot third-party protocol paths, then rerun tarball install/typecheck/build and authorized wallet smokes. |

## 2026-06-04 Latest Tarball Frontend Acceptance Recheck

This pass reran Copilot consumer acceptance against the latest tarballs:

```text
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-lending-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-wallet-client-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz
/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz
```

Frontend acceptance still used the temporary detached Copilot worktree at `/tmp/copilot-sdk-v2-acceptance`; the real `copilot` worktree was not modified.

Install verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm add -w @naviprotocol/lending@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-lending-2.0.0-beta.0.tgz @naviprotocol/wallet-client@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-wallet-client-2.0.0-beta.0.tgz @naviprotocol/astros-aggregator-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-aggregator-sdk-2.0.0-beta.0.tgz @naviprotocol/astros-bridge-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz @naviprotocol/astros-dca-sdk@file:/tmp/navi-sdk-v2-packs-20260603202116/naviprotocol-astros-dca-sdk-2.0.0-beta.0.tgz --ignore-scripts
```

Result: install passed after the earlier registry failures. The install still prints frontend-owned Sui v1/v2 peer warnings, but the installed NAVI SDK tarballs are the latest `2.0.0-beta.0` package set.

Targeted frontend typecheck:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending-next typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-migrate typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/copilot-store typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap typecheck
```

Result: all targeted typechecks passed.

Targeted frontend builds:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/swap build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/lending-next build
```

Results:

- `@naviprotocol/swap` build passed.
- `@naviprotocol/astros` build passed after rerunning outside the sandbox because Turbopack needed local port binding during production build.
- `@naviprotocol/astros-aggregator` build passed after rerunning outside the sandbox.
- `@naviprotocol/lending-next` build failed during Turbopack production build after TypeScript passed. The material failures are still frontend third-party protocol SDKs importing Sui v1-era exports under `@mysten/sui@2.17.0`: `SuiClient`, `getFullnodeUrl`, `fromB64`, `fromHEX`, and `@mysten/sui/graphql/schemas/latest`. Import traces go through `packages/copilot-store/src/protocols/*` into Cetus, Magma, Scallop, Firefly, and Haedal paths.

Dependency tree recheck:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/lending --filter @naviprotocol/lending-next
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/wallet-client --filter @naviprotocol/copilot-migrate
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/astros-bridge-sdk --filter @naviprotocol/astros
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/astros-aggregator-sdk --filter @naviprotocol/astros
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @naviprotocol/astros-dca-sdk --filter @naviprotocol/astros
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mysten/sui.js --filter @naviprotocol/lending-next
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @suilend/sdk --filter @naviprotocol/lending-next
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mysten/sui.js --filter @naviprotocol/astros
```

Results:

- `@naviprotocol/lending-next` consumes `@naviprotocol/lending@2.0.0-beta.0` directly and through Copilot/store/wallet-client paths.
- `@naviprotocol/copilot-migrate` consumes `@naviprotocol/wallet-client@2.0.0-beta.0`.
- `@naviprotocol/astros` consumes `@naviprotocol/astros-bridge-sdk@2.0.0-beta.0`, `@naviprotocol/astros-aggregator-sdk@2.0.0-beta.0`, and `@naviprotocol/astros-dca-sdk@2.0.0-beta.0`.
- Remaining `@mysten/sui.js@0.54.1` paths in `@naviprotocol/lending-next` are from `@msafe/*`, `packages/copilot-store`, AlphaFi/7K/FlowX, Suilend/FlowX, and Haedal farm SDK.
- Remaining `@suilend/sdk` paths in `@naviprotocol/lending-next` are from `@msafe/sui-app-store` and `packages/copilot-store`; they no longer come from `@naviprotocol/wallet-client`.
- Remaining `@mysten/sui.js@0.54.1` paths in `@naviprotocol/astros` are through workspace `packages/swap-core -> @msafe/sui-wallet`, not the SDK v2 tarballs.

Bridge frontend lazy evidence used stronger adapter signatures to avoid treating UI text as SDK-load evidence:

```bash
rg -n "createSwapFromSuiMoveCalls|MAYAN_FORWARDER_CONTRACT|swapFromSolana|swapFromEvm|@mayanfinance/swap-sdk|fromSuiMoveCalls" apps/astros/.next/static
rg -n "createSwapFromSuiMoveCalls|MAYAN_FORWARDER_CONTRACT|swapFromSolana|swapFromEvm|@mayanfinance/swap-sdk|fromSuiMoveCalls" apps/astros-aggregator/.next/static
node -e 'const fs=require("fs"); const path=require("path"); const apps=["apps/astros","apps/astros-aggregator"]; const sigs=["createSwapFromSuiMoveCalls","MAYAN_FORWARDER_CONTRACT","swapFromSolana","swapFromEvm","@mayanfinance/swap-sdk","fromSuiMoveCalls"]; for (const app of apps){ const manifest=JSON.parse(fs.readFileSync(path.join(app,".next/build-manifest.json"),"utf8")); const pages=manifest.pages||{}; const interesting=Object.keys(pages).filter(p=>p==="/"||p.includes("swap")||p.includes("bridge")||p.includes("dca")||p.includes("[[...")||p.includes("[...")); console.log(`APP ${app}`); for (const page of interesting.sort()){ const files=pages[page]||[]; const hits=[]; for (const f of files){ const full=path.join(app,".next",f); if (!fs.existsSync(full)) continue; const text=fs.readFileSync(full,"utf8"); for (const sig of sigs) if (text.includes(sig)) hits.push(`${sig} in ${f}`); } console.log(`${page}: files=${files.length} strongHits=${hits.length}${hits.length?" "+hits.join("; "):""}`); } }'
```

Results:

- Strong adapter signature scan produced no hits in `apps/astros/.next/static` or `apps/astros-aggregator/.next/static`.
- `build-manifest.json` page-entry scan found `strongHits=0` for `/`, `/swap/[pair]`, `/widget/swap`, `/bridge/[chains]`, `/bridge/[chains]/[pair]`, and `/dca/[pair]` in both apps.
- This is stronger than the previous broad Mayan text scan: it supports that root and route page entries do not load the Mayan Sui v1 adapter signatures after the latest tarball build.

Bridge / route HTTP smoke:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros exec next start -p 4010
node -e 'const routes=["/","/swap/SUI-USDC","/bridge/sui-solana","/bridge/sui-solana/SUI-SOL","/dca/SUI-USDC"]; (async()=>{for(const r of routes){const res=await fetch("http://localhost:4010"+r,{redirect:"manual"}); const text=await res.text(); console.log(`${r} status=${res.status} location=${res.headers.get("location")||""} bytes=${text.length}`);}})()'
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator exec next start -p 4011
node -e 'const routes=["/","/swap/SUI-USDC","/bridge/sui-solana","/bridge/sui-solana/SUI-SOL","/dca/SUI-USDC"]; (async()=>{for(const r of routes){const res=await fetch("http://localhost:4011"+r,{redirect:"manual"}); const text=await res.text(); console.log(`${r} status=${res.status} location=${res.headers.get("location")||""} bytes=${text.length}`);}})()'
```

Results:

- `apps/astros`: `/` returned `307` to `/perp/SUI-USD`; `/swap/SUI-USDC`, `/bridge/sui-solana`, `/bridge/sui-solana/SUI-SOL`, and `/dca/SUI-USDC` returned `200`.
- `apps/astros-aggregator`: `/` returned `307` to `/swap/SUI-NAVX`; `/swap/SUI-USDC`, `/bridge/sui-solana`, `/bridge/sui-solana/SUI-SOL`, and `/dca/SUI-USDC` returned `200`.
- The local `next start` sessions were stopped after the smoke requests.
- This satisfies built-app HTTP route smoke for Astros and Aggregator consumers. It does not satisfy authorized wallet sign/execute/status smoke.

Current acceptance conclusion after this recheck:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Latest SDK v2 tarballs can be installed by Copilot | Passed with warnings | Latest `pnpm add -w ... --ignore-scripts` passed in `/tmp/copilot-sdk-v2-acceptance`; peer warnings still expose frontend-owned Sui v1/v2 conflicts. |
| Targeted frontend typecheck | Passed | lending-next, astros, astros-aggregator, copilot-migrate, copilot-store, and swap typechecks passed. |
| Targeted frontend build | Partially passed | swap, astros, and astros-aggregator passed; lending-next remains blocked by frontend third-party Sui v1/v2 protocol SDK imports. |
| Bridge root/lazy/frontend route smoke | Passed for deterministic and HTTP route gates | SDK boundary/lazy tests already pass; latest strong-signature chunk scan and multi-route HTTP smoke passed for astros and astros-aggregator. |
| No unacceptable frontend Sui v1/v2 dependency conflict | Blocked outside SDK package ownership | Remaining paths are MSafe, Copilot protocol store, swap-core, and third-party protocol SDKs, not latest NAVI SDK tarballs. |
| Authorized wallet business smoke | Blocked | Not run because full frontend acceptance remains blocked by `apps/lending` build/dependency conflicts and live SDK smoke fixtures/RPC remain unstable. |

Updated blocker status:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| `apps/lending` production build is blocked by frontend third-party protocol SDKs under Sui v2 | Prevents full frontend build acceptance and route-level lending/copilot wallet smoke. | Latest tarball install and typecheck passed, then Turbopack failed on Cetus/Magma/Scallop/Firefly/Haedal packages importing old Sui v1-era exports under `@mysten/sui@2.17.0`. | Frontend/open-api/protocol owner to isolate or upgrade affected protocol SDKs, pin compatible versions, or disable affected Copilot protocol imports for the SDK v2 frontend gate. |
| Frontend dependency tree still has unacceptable Sui v1/v2 conflicts | Final acceptance cannot claim a clean v2 dependency graph. | Latest dependency tree still has `@mysten/sui.js@0.54.1` through MSafe, Copilot store protocol SDKs, swap-core, and related third-party packages. | Frontend owner to remove or isolate legacy Sui v1 protocol/wallet paths from v2 acceptance targets. |
| Authorized wallet live business smoke not run | Lending, swap, bridge, DCA, and wallet-wrapper business acceptance remains incomplete. | Deterministic SDK tests, latest frontend typechecks/builds, strong-signature chunk scan, and HTTP smoke evidence exist; real sign/execute was not attempted while frontend build and dependency graph are blocked. | Run with authorized test wallet and small amounts after frontend target routes can build and load without v1/v2 dependency conflicts. |
| Live SDK smoke is not deterministic with current public fixtures/RPC | Prevents using existing `NAVI_LIVE_TESTS=1` suite as a stable green release gate. | Earlier live smoke attempts hit RPC resets, DNS failure, chain-state fixture failures, EMode registry lookup failure, and reward timeout. | Provide controlled RPC and funded/owned golden-wallet fixtures or accept these as external live-smoke blockers for beta. |

## 2026-06-04 SDK Live Smoke Update

This pass used the authorized Sui test wallet from the local secret catalog. Secret values were not printed, copied into repo files, or committed. The public test address had enough SUI for gas before the smoke run:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending exec node --input-type=module -e '...getBalance...'
```

Result before execute: `totalBalance=2384387285`, `coinObjectCount=1`.

Wallet-client balance wrapper live read / dry-run smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 address="$FE_E2E_SUI_ADDRESS" pnpm --filter @naviprotocol/wallet-client exec vitest --config ./vite.config.unit.js tests/balance.test.ts --run -t "update portfolio|portfolio|send coins to many"
```

Result: passed, `3 passed / 2 skipped`. Coverage: balance portfolio read/update and SUI batch-send dry-run.

Wallet-client lending wrapper live read / dry-run smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH NAVI_LIVE_TESTS=1 address="$FE_E2E_SUI_ADDRESS" pnpm --filter @naviprotocol/wallet-client exec vitest --config ./vite.config.unit.js tests/lending.test.ts --run -t "deposit SUI|deposit vSUI|withdraw SUI|borrow SUI|get health factor|claim all rewards|update oracle|getLendingState"
```

Result: passed, `8 passed / 1 skipped`. Coverage: deposit/withdraw/borrow/claim/update-oracle dry-runs plus health factor and lending state reads. The `repay SUI` case remains skipped for this wallet because the current account state aborts in `execute_repay` dry-run.

Aggregator SDK live quote -> PTB -> dry-run smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator-sdk exec node --input-type=module - <<'NODE'
// SUI -> USDC, 0.01 SUI, getQuote -> buildSwapPTBFromQuote -> dryRunSwapTransaction
NODE
```

Result:

```json
{
  "pair": "SUI->USDC",
  "routeCount": 1,
  "status": "success",
  "events": 4,
  "balanceChanges": 3,
  "objectChanges": 13
}
```

DCA SDK live create-order dry-run smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-dca-sdk exec node --input-type=module - <<'NODE'
// SUI -> USDC, 0.01 SUI depositedAmount, createDcaOrder -> dryRunDcaTransaction
NODE
```

Result:

```json
{
  "flow": "DCA create SUI->USDC",
  "status": "success",
  "error": null,
  "events": 1,
  "balanceChanges": 1,
  "objectChanges": 6
}
```

Pyth v2 builder multi-feed dry-run smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending exec node --input-type=module - <<'NODE'
// getConfig -> SUI/USDC pythPriceFeedId -> updatePythPriceFeeds -> dryRunTransactionBlock
NODE
```

Result:

```json
{
  "flow": "Pyth update multi-feed",
  "feedCount": 2,
  "updatedObjects": 2,
  "txBytes": 3483,
  "status": "success",
  "error": null,
  "events": 2,
  "balanceChanges": 3,
  "objectChanges": 5
}
```

Pyth v2 builder real execute smoke:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_PRIVATE_KEY=|^FE_E2E_SUI_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/lending exec node --input-type=module - <<'NODE'
// decode authorized test key -> SUI/USDC updatePythPriceFeeds -> signAndExecuteTransaction -> waitForTransaction
NODE
```

Result:

```json
{
  "flow": "Pyth update multi-feed execute",
  "feedCount": 2,
  "digest": "ET7AMPCEihC3h9nadXFRD3YXPobNtg6GQLEQbCsMpbV5",
  "status": "success",
  "finalityStatus": "success",
  "events": 0,
  "balanceChanges": 3,
  "objectChanges": 5
}
```

Balance check after execute:

```json
{
  "totalBalance": "2383719195",
  "coinObjectCount": 1
}
```

This execute consumed gas only. It did not transfer user assets, swap, bridge, or open a lending/DCA position.

Additional observation: an earlier `pnpm --filter @naviprotocol/wallet-client test -- tests/balance.test.ts --run -t ...` invocation passed the arguments through the package script incorrectly and ran the broad wallet-client live suite. It produced `18 passed / 9 failed`. The failures remain fixture/API blockers rather than SDK v2 deterministic regressions: hard-coded object owned by a different address, Haedal unstake amount greater than wallet balance, open-aggregator 404 for legacy migration/swap pairs, disabled optional Suilend protocol, and current wallet state aborting the repay dry-run.

Updated acceptance status:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Pyth Hermes update data / dynamic package id / base update fee / dry-run / real execute / chain query | Passed for SDK live smoke | Multi-feed SUI/USDC dry-run succeeded; real authorized test-wallet execute succeeded with digest `ET7AMPCEihC3h9nadXFRD3YXPobNtg6GQLEQbCsMpbV5`; post-execute balance confirms gas-only impact. |
| Wallet-client wrapper smoke | Partially passed | Balance and lending wrapper read/dry-run smoke passed for the authorized test address. Swap wrapper remains blocked by open-aggregator legacy pair 404; Suilend is intentionally optional legacy and disabled by default. |
| Aggregator minimal PTB / simulate smoke | Passed for live SDK dry-run | SUI -> USDC quote/PTB/dry-run succeeded against live open aggregator and Sui RPC. |
| DCA minimal PTB / simulate smoke | Passed for live SDK dry-run | SUI -> USDC create order PTB dry-run succeeded against live Sui RPC. |
| Bridge live execute/status | Still blocked / not rerun in this pass | SDK deterministic Mayan adapter sign/execute unit coverage and frontend lazy/route smoke exist, but current live Bridge execute/status was not rerun. |
| Frontend full acceptance | Still blocked outside SDK ownership | `apps/lending` production build and frontend dependency tree remain blocked by Copilot/MSafe/third-party Sui v1 paths recorded above. |

## 2026-06-04 Bridge Mayan v2 Packaging And Live Dry-Run Recheck

Bridge package update:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk why @mysten/sui
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm view @mayanfinance/swap-sdk@14.2.0 dependencies peerDependencies --json
```

Findings:

- `@mayanfinance/swap-sdk@13.3.0` depends on `@mysten/sui@1.38.0`; latest published `@mayanfinance/swap-sdk@14.2.0` still declares `@mysten/sui: ^1.34.0`.
- Because the shared NAVI Vite library config externalizes package dependencies, publishing Bridge SDK with Mayan external would still let consumers install Mayan's Sui v1 copy.
- `packages/astros-bridge-sdk/vite.config.js` now bundles `@mayanfinance/swap-sdk` into the Bridge lazy chunk while keeping `@mysten/sui/*` as peer external.
- `packages/astros-bridge-sdk/tests/build-config.test.ts` locks this build boundary so Mayan is bundled and Sui remains external.

Verification:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk exec tsc --noEmit
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
rg "@mayanfinance/swap-sdk|@mysten/sui" packages/astros-bridge-sdk/dist/index.esm.js packages/astros-bridge-sdk/dist/mayan-*.js
```

Results:

- Bridge tests passed: `5 files passed / 6 tests passed`.
- Bridge build passed and emitted `dist/index.esm.js` plus `dist/mayan-BVHuziOT.js`.
- Bridge typecheck passed.
- SDK v2 boundary scan passed.
- Dist scan found no `@mayanfinance/swap-sdk` import in root or lazy output; the lazy Mayan chunk imports only `@mysten/sui/transactions` and `@mysten/sui/utils` as peer externals.

Bridge live dry-run attempts:

```bash
set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=|^FE_E2E_BNB_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk exec node --input-type=module - <<'NODE'
// SUI -> Arbitrum native USDC, 1.3 SUI, SDK getQuote -> SDK swap() -> v2 wallet signTransaction hook -> transaction.build({ client })
NODE

set -a; eval "$(rg "^FE_E2E_SUI_ADDRESS=|^FE_E2E_SOL_ADDRESS=" /Users/Tmac/.cursor/rules/local-secrets.mdc)"; set +a
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk exec node --input-type=module - <<'NODE'
// SUI -> Solana native USDC, 1.3 SUI, SDK getQuote -> SDK swap() -> v2 wallet signTransaction hook -> transaction.build({ client })
NODE
```

Results:

- SUI -> Arbitrum USDC quote returned one Mayan MCTP route. After the packaging change, the wallet hook received a v2 `Transaction`, proving the previous Mayan Sui v1 BCS crash is removed. The v2 transaction build then failed with `Transaction resolution failed: CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue } in command 9`.
- SUI -> Solana native USDC quote returned one Mayan MCTP route and failed with the same class of v2 resolver error: `CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue } in command 11`.
- Transaction JSON inspection showed Mayan's Sui-source route constructs `MakeMoveVec` elements from earlier swap command `Result` values where the referenced Move calls do not provide values under the v2 resolver. This is upstream Mayan Sui route-builder behavior, not an SDK root/lazy packaging issue.
- No Bridge transaction was signed or executed in these attempts.

Updated Bridge conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Bridge root does not load Mayan/Sui v1 | Passed | Root lazy unit test, SDK boundary scan, frontend strong-signature scans, and HTTP route smoke already pass. |
| Bridge published SDK avoids Mayan transitive Sui v1 at runtime | Improved / passed for NAVI bundle output | Bridge now bundles Mayan into the lazy chunk and leaves `@mysten/sui/*` as peer external; dist scan confirms no external Mayan import remains. |
| Bridge v2 wallet adapter contract | Passed deterministically | Unit coverage confirms SDK `swap()` path calls Mayan, receives a v2 transaction in the wallet `signTransaction` contract, executes through v2 `executeTransactionBlock`, and waits for the digest. |
| Bridge live v2 build/dry-run/execute/status | Blocked by Mayan upstream route builder | Live SUI-source MCTP routes to both Arbitrum and Solana fail during v2 `transaction.build({ client })` with `ArgumentWithoutValue`, before signing or execution. |

Updated blocker:

| Blocker | Impact | Evidence | Needed decision / owner |
| --- | --- | --- | --- |
| Mayan Sui-source MCTP route builder is not v2-resolver compatible | Prevents Bridge live dry-run, execute, and status acceptance for SUI-source Bridge routes in SDK v2 beta. | Latest Mayan package still depends on Sui v1; after bundling Mayan against the SDK v2 peer, both SUI -> Arbitrum USDC and SUI -> Solana USDC live routes produce invalid `Result` references and fail with `CommandArgumentError { arg_idx: 0, kind: ArgumentWithoutValue }`. | Bridge/Mayan owner must provide a Sui SDK 2 compatible route builder or NAVI must replace/rewrite the Mayan Sui adapter. Until then, SDK can only ship deterministic/lazy/root packaging coverage and record live Bridge as blocked. |

## 2026-06-04 Bridge Runtime Dependency Cleanup And Frontend Recheck

Bridge packaging follow-up:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --lockfile-only
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk why @mayanfinance/swap-sdk --dev
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk why @mysten/sui --prod
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk exec tsc --noEmit
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-bridge-sdk test -- --run
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm test:sdk-v2-boundaries
```

Results:

- `@mayanfinance/swap-sdk` moved from Bridge runtime dependencies to devDependencies. Published consumers no longer install Mayan's own Sui v1 dependency tree just by installing `@naviprotocol/astros-bridge-sdk`.
- `pnpm why @mayanfinance/swap-sdk --dev --filter @naviprotocol/astros-bridge-sdk` shows Mayan only under devDependencies.
- `pnpm why @mysten/sui --prod --filter @naviprotocol/astros-bridge-sdk` produced no output; Bridge's Sui dependency is peer-only for runtime consumers.
- Bridge build, typecheck, tests, and SDK v2 boundary scan passed after the dependency move.

Clean Bridge tarball:

```bash
PACK_DIR=/tmp/navi-sdk-v2-packs-202606041052-clean
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm pack --pack-destination "$PACK_DIR"
tar -xOf "$PACK_DIR/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz" package/package.json
```

Result:

- Tarball path: `/tmp/navi-sdk-v2-packs-202606041052-clean/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz`.
- Tarball runtime dependencies are only `@solana/web3.js`, `axios`, and `ethers`.
- Tarball peer dependencies keep `@mysten/sui: >=2.0.0`.
- Tarball still includes `dist/mayan-BVHuziOT.js`, so Mayan runtime code is available from the Bridge lazy chunk without exposing the Mayan package as a consumer dependency.

Temporary Copilot consumer recheck:

```bash
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm add -w /tmp/navi-sdk-v2-packs-202606041052-clean/naviprotocol-astros-bridge-sdk-2.0.0-beta.0.tgz --ignore-scripts
# Updated the temporary /tmp/copilot-sdk-v2-acceptance pnpm.overrides entry for @naviprotocol/astros-bridge-sdk to the same clean tarball.
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --ignore-scripts
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mayanfinance/swap-sdk --filter @naviprotocol/astros
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm why @mayanfinance/swap-sdk --filter @naviprotocol/astros-aggregator
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --filter @naviprotocol/astros-aggregator typecheck
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros build
PATH=/Users/Tmac/.nvm/versions/node/v22.22.2/bin:$PATH SKIP_ENV_VALIDATION=true pnpm --filter @naviprotocol/astros-aggregator build
```

Results:

- After updating the temporary Copilot override, `pnpm why @mayanfinance/swap-sdk --filter @naviprotocol/astros` produced no output.
- `pnpm why @mayanfinance/swap-sdk --filter @naviprotocol/astros-aggregator` also produced no output.
- `@naviprotocol/astros` typecheck and production build passed with the clean Bridge tarball.
- `@naviprotocol/astros-aggregator` typecheck and production build passed with the clean Bridge tarball.

Frontend Bridge bundle scan after the clean tarball:

```bash
node - <<'NODE'
// Scanned apps/astros and apps/astros-aggregator .next/static plus build-manifest page entries for:
// createSwapFromSuiMoveCalls, MAYAN_FORWARDER_CONTRACT, swapFromSolana, swapFromEvm, @mayanfinance/swap-sdk, fromSuiMoveCalls
NODE
```

Results:

- `apps/astros`: `staticStrongHits=0`; `/`, `/bridge/[chains]`, `/bridge/[chains]/[pair]`, `/dca/[pair]`, `/perp/[[...slug]]`, `/swap/[pair]`, and `/widget/swap` all had `strongHits=0`.
- `apps/astros-aggregator`: `staticStrongHits=0`; `/`, `/bridge/[chains]`, `/bridge/[chains]/[pair]`, `/dca/[pair]`, `/swap/[pair]`, and `/widget/swap` all had `strongHits=0`.

Updated Bridge dependency conclusion:

| Checklist area | Current status | Evidence / blocker |
| --- | --- | --- |
| Bridge SDK runtime dependency tree avoids Mayan's Sui v1 dependency | Passed for clean Bridge tarball and Astros consumers | Bridge package moved Mayan to devDependency, bundles Mayan in the lazy chunk, and keeps Sui as peer-only. Clean tarball install into temporary Copilot shows no Mayan dependency path for `astros` or `astros-aggregator`. |
| Bridge frontend type/build with clean tarball | Passed for Astros apps | `@naviprotocol/astros` and `@naviprotocol/astros-aggregator` typecheck/build passed after installing the clean Bridge tarball. |
| Bridge root/page bundle signatures | Passed | Strong signature scan found zero hits across built static assets and key page manifest entries in both frontend apps. |
| Bridge live execute/status | Still blocked | Mayan Sui-source route builder remains v2-resolver incompatible as recorded above; no real Bridge signature or execution was attempted. |
