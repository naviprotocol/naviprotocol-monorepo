# Sui SDK v2 Acceptance

Last updated: 2026-06-08

## Current Status

The SDK code is in a PR-ready state for review, but not final release-ready
until live smoke blockers are closed or explicitly accepted.

| Area                       | Status                       | Evidence                                                                                                           |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SDK package build          | Passed                       | `lending`, `wallet-client`, `astros-aggregator-sdk`, `astros-bridge-sdk`, and `astros-dca-sdk` build successfully. |
| SDK package tests          | Passed                       | Default deterministic tests pass for the target SDK packages.                                                      |
| Type compatibility         | Passed                       | Type tests pass for packages that expose `test:types`; Bridge has no `test:types` script.                          |
| SDK v2 boundary scan       | Passed                       | Root bundles and public declarations pass the Sui v2 boundary script.                                              |
| Suilend v3 adapter         | Passed with live-read caveat | Adapter unit tests pass; live Suilend initialization succeeds after scoping the test fetch shim.                   |
| Bridge Mayan lazy boundary | Passed                       | Mayan/Sui v1 are limited to Bridge lazy artifacts and tests.                                                       |
| Aggregator execute DTO     | Passed                       | Execute result preserves normalized fields, passthrough fields, and `raw`.                                         |
| Live smoke                 | Blocked                      | Current public fixtures/routes/account states are not stable enough for a full green run.                          |

## Latest Deterministic Verification

Run these gates before merging a release candidate:

```bash
pnpm --filter @naviprotocol/lending build
pnpm --filter @naviprotocol/wallet-client build
pnpm --filter @naviprotocol/astros-aggregator-sdk build
pnpm --filter @naviprotocol/astros-bridge-sdk build
pnpm --filter @naviprotocol/astros-dca-sdk build
pnpm run test:sdk-v2-boundaries
```

The current branch has already passed the target package builds, deterministic
package tests, type compatibility tests where defined, and the SDK v2 boundary
scan. Targeted tests also cover Suilend adapter lazy loading, Bridge Mayan lazy
loading, Bridge legacy bytes parsing, Aggregator transaction result
normalization, and lending live PTB oracle-await behavior.

## Live Smoke Result

The latest no-broadcast live smoke used `NAVI_LIVE_TESTS=1` and covered lending,
wallet-client, and aggregator read/dry-run paths. It did not perform real
wallet signatures or source-chain broadcasts.

| Package                               | Result               | Blocking failures                                                                                        |
| ------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `@naviprotocol/lending`               | 31 passed / 1 failed | `repayCoinPTB` dry-run aborts with `MoveAbort 1602`, which depends on the current test account state.    |
| `@naviprotocol/wallet-client`         | 12 passed / 8 failed | Test wallet balance/position gaps, old migration route API `404`, and repay dry-run account-state abort. |
| `@naviprotocol/astros-aggregator-sdk` | 4 passed / 1 failed  | DEEP -> SUI DeepBook live quote API currently returns `400`.                                             |

Important Suilend finding: the earlier `Protocol suilend not found` live failure
was caused by the test fetch shim adding NAVI web headers to Sui fullnode gRPC
requests. The shim now applies those headers only to NAVI domains. After that,
Suilend initializes and reads pool data; the remaining cross-protocol failures
are aggregator route API failures.

## Risk Classification

| Risk                                                                     | Classification                           | Release impact                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Deterministic SDK tests fail                                             | Blocking                                 | Not currently present.                                                                                 |
| Public API leaks old Sui v1 types                                        | Blocking                                 | Not currently present.                                                                                 |
| Root bundle loads Mayan/Sui v1 or Suilend                                | Blocking                                 | Not currently present.                                                                                 |
| Live smoke fails because current fixture wallet lacks balances/positions | Acceptance blocker                       | Needs updated fixtures or explicit acceptance.                                                         |
| Live smoke fails because route API returns 400/404 for old pairs         | Acceptance blocker / external dependency | Needs current valid route fixtures or aggregator owner confirmation.                                   |
| Repay dry-run aborts for current account state                           | Acceptance blocker                       | Needs a wallet fixture with expected borrow/debt state or a test expectation update.                   |
| Frontend-owned third-party packages still carry Sui v1 paths             | Outside SDK package ownership            | Must be handled by frontend/open-api/protocol owners before claiming clean full-app Sui v2 acceptance. |

## Release Decision

The SDK branch can continue through PR review because the code-level gates that
protect integration cost and Sui v2 boundaries pass.

Do not mark the beta as fully releasable until one of these is true:

1. live smoke passes with controlled RPC, valid route fixtures, and funded
   golden wallets; or
2. product/engineering accepts the listed live blockers as non-SDK blockers and
   records owner, impact, and follow-up plan.

## Acceptance Checklist

- [x] Node.js 22 deterministic SDK gates pass.
- [x] SDK public entry points use Sui SDK v2 imports.
- [x] Old Sui v1 public types are blocked by boundary scan.
- [x] `lending` main path does not depend on `pyth-sui-js`.
- [x] Suilend is v3, optional, and lazy.
- [x] Bridge Mayan/Sui v1 implementation is internal and lazy.
- [x] Bridge Sui path preserves caller gas semantics unless `gasBudget` is set.
- [x] Aggregator execute result is a backward-compatible superset.
- [ ] Live smoke has a stable, green fixture set.
- [ ] Frontend/open-api owners close or accept remaining non-SDK Sui v1 paths.
