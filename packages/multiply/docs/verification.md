# Multiply verification record

## Numeric Registry adaptation — 2026-11-03

Published package: `0.2.0-preview.20261103.1`, npm dist-tag `preview`; `latest` remains `0.2.0-preview.20261102.1`. The downloaded registry tarball exactly matches the tested artifact.
API pins the published npm version and is deployed to [Vercel Preview](https://navi-open-6pzzj8t2y-navi-fd9a1df6.vercel.app) (`dpl_7bNtZmwgobJBYYbbvx9srmKHLjoG`, READY). Three strategy quote/build simulations, numeric Registry PTB checks, cached rebuilds, catalogues, positions and 5 HTTP contract groups passed. No signing or broadcast.
Artifact SHA-256
`c46b0e65292b54b50d8b62e46b016e1aaf7fdd575d1a93d498ac9d0354e5de5d`.

- SDK: 113 tests passed (`vitest run tests` from this package), TypeScript,
  source ESLint and Vite distribution/types build passed.
- API: 73 Multiply tests passed with this installed artifact; changed-file ESLint
  passed. Full tsc has 9 unrelated errors reproduced in the pre-change snapshot.
- Frontend: typecheck and 49 targeted tests passed; desktop/mobile fixture browser
  coverage passed 4 cases. ESLint has 0 errors and 2 pre-existing warnings.
- `node e2e/registry.mjs`: mainnet read-only simulation passed empty discovery,
  metadata-free create/register/read, duplicate-key abort, and final empty lookup.
  Evidence: `/tmp/multiply-registry-adaptation-evidence/report.json`.
- Full mainnet lifecycle E2E: **16/16 scenarios passed**, including vSUI/haSUI
  opens, fallback swaps, add/remove principal, leverage adjustments, repay,
  collateral addition and both full closes. Registry lookup in each simulated
  PTB verifies the numeric key points to its actual newly created Cap.
  Evidence: `/tmp/multiply-registry-full-e2e/report.json`; artifact hash verifier passed.
- Independent cross-review found no actionable issue in the task delta.

Only registered numeric keys are discovered. Unregistered Caps are intentionally
excluded. Every new creation binds sender and registers atomically; no Cap metadata
getter or setter is needed. The deployed Registry/helper ABI was exercised by the
read-only VM check. No signing/broadcast or persisted chain mutation occurred.

Earlier records below describe earlier versions and must not be treated as
acceptance evidence for the numeric Registry change.

## Current refund and dependency policy — 2026-11-02

Multiply now uses published Lending 2.1.0 and Astros 2.0.7. Astros keeps its default
fee behavior and refunds route change directly to the address in the Multiply quote.
The converter receives that address explicitly; missing, malformed and zero recipients
are rejected. Other engine coins remain caller-managed through `built.coins`.

The clean-consumer runner packs only Multiply and installs its dependencies from npm
without overrides. E2E assertions decode every `transfer_nonzero` recipient and compare
it with `quote.address`, including builds with a different preconfigured sender. The
2026-10-29 results below describe the previous implementation, not this refund policy.

### Verified preview result

- Package: `@naviprotocol/multiply@0.2.0-preview.20261102.1`.
- Clean npm consumer: **16/16 mainnet simulation scenarios passed, zero retries**.
- Run: `2026-11-02T07:13:53.580Z` to `2026-11-02T07:17:15.066Z`.
- The offline verifier passed all **101 artifact hashes**.
- Extra live-route simulation returned **1,234,567 MIST** of unused input to a
  recipient distinct from the transaction sender; saved balance changes confirm receipt.
- Build, TypeScript and changed-source ESLint checks passed. All 30 installed
  distribution files match the workspace build byte for byte.
- Tarball SHA-256: `81e61ce04591a6efe2d91d8b56a6548ad32f8b7d4d24f689e5df88b5d97358fb`.
- Bundle: `out/multiply/preview-20261102-1/`, including npm consumer lockfile,
  E2E evidence and `refund-proof.mjs` / `refund-proof.json`.
- No blockchain signing or broadcast. Published to npm on 2026-11-02 with the
  `preview` tag; an anonymous registry download matches the tested tarball SHA-256.

## Scope and provenance

This release uses E2E as the only behavioral verification mechanism. TypeScript
checking and packaging are build prerequisites, not unit tests.

- Base: `a055576` on `origin/main`.
- Branch: `zado/multiply-package`.
- Test contract and failure inventory committed first: `57804f1`.
- First run: `e2e/evidence/initial-red.json`, failed because no package distribution
  existed. No implementation source preceded this commit.
- Getter schema and smaller haSUI test principal corrected before implementation:
  `fba268f`. The fixture uses deployed `supply_index` / `borrow_index` fields.
- Subsequent E2E-only changes check actual VM outcomes, not just PTB success, and
  use the publicly configured NAVI oracle sender for funded simulation.

## Discovered failures

1. The original public address had insufficient gas balance. The runner now uses
   NAVI's publicly configured oracle sender, overrideable by environment variable.
   No private keys or signatures are involved.
2. Full close using `u64::MAX` aborted with NAVI code `1506`: pool-liquidity
   validation occurs before the contract clamps to the user's balance. The builder
   now refreshes indices, reads the actual balance in the same PTB, converts it
   safely to u64, withdraws it, and checks that collateral/debt are both zero.

3. The first clean consumer resolved a published Astros transitive dependency
   despite a direct local tarball dependency. Its missing composable capability
   marker correctly caused import failure. The consumer runner now records explicit
   pnpm overrides for all local tarballs. These are prerelease source artifacts;
   Changesets must advance the dependency range before public npm publication.

4. Public RPC/API connections occasionally returned `TypeError: fetch failed`.
   The runner permits one fresh scenario attempt for exactly that transport error.
   Failed-attempt artifacts are renamed and retained; the report records every
   attempt. Assertions and Move/build errors are never retried as transport failures.

## Reproducibility boundaries

All full transactions are simulated with checks enabled. Read-only getter probes
use checks disabled, and every such response is labelled. The runner never signs
or broadcasts. A saved response proves the observed execution, while replaying
against live shared objects can yield a different result. This is not a frozen
chain fork or evidence of a persisted user lifecycle.

Follow-up actions prepend a real simulated open transaction. The source supplies
only its VM-read, uncommitted balances under a logical fixture Cap ID, and the
actual Cap travels as a transaction result. Protocol balances, prices, exchange
rates, quotes and execution are not stubbed. Persistence-based discovery, wrapped
Vault custody and concurrent Cap creation require a deployment-level E2E with
funded test accounts/registry before claiming those guarantees.

## Evidence and package replay

The final report and packed artifact hashes are recorded below. See the root
`out/multiply/` directories for all raw intermediate responses, including failures.

Offline artifact verification:

```sh
node packages/multiply/e2e/verify-evidence.mjs out/multiply/<complete-run>
```

The verifier rejects duplicate/missing artifacts, altered hashes, subset runs or
any failed/missing scenario. A passing archived response is historical evidence;
this verifier does not contact the network or claim a fresh simulation succeeded.

Clean packed consumer (packs Multiply and installs its published dependencies into a
fresh OS temporary directory with no workspace links or dependency overrides):

```sh
pnpm --filter @naviprotocol/multiply test:e2e:package
```

Its output bundle includes the Multiply `.tgz`, package hashes, consumer package
manifest and npm lockfile, and the complete E2E evidence directory. Run the offline
verifier on its `e2e/` subdirectory. Package release uses Changesets; no npm
publication is part of this verification command.

## Final result — 2026-10-29

- Verified source: `40895847f026e63f88b36dbbee617d67941b513e`; working tree was clean when the run began.
- Final run: **15/15 passed, zero retries**, loaded from a clean tarball consumer.
- Began: `2026-10-29T14:34:54.003Z`; finished: `2026-10-29T14:43:45.961Z`.
- **96 E2E artifact hashes verified**. Both Volo and Haedal close outcomes have
  collateral = 0 and debt = 0. No transactions were signed or broadcast.
- Multiply and Astros TypeScript checks passed; changed implementation files passed
  repository ESLint. These are static build checks, not unit tests.
- All three package tarballs were byte-identical across two separate builds with
  unchanged production source. Their exact hashes are in `evidence/final-packages.json`
  (relative to the `e2e/` directory) and the bundle's `packages.json`.

The complete local artifact is:

`out/multiply/multiply-4089584-e2e-bundle.tar.gz`

Its directory before archiving is:

`out/multiply/package-2026-10-29T14-34-33-445Z/`

The bundle includes a Git bundle of the test-first history and verified source,
three npm tarballs, clean-consumer manifests/lockfiles, an offline verifier, all
raw E2E evidence, and `REPRODUCE.md`. Git bundle verification passed; its base
prerequisite is `a05557682fe3945114c269531f51f8e055016e31`.

Changesets status was checked without applying versions or publishing. The pending
release plan advances Multiply to 0.2.0 and Astros to 2.1.0. Current tarballs are
local prerelease artifacts, installed together using the recorded overrides.

Archive SHA-256:

`f127d0f11480b60efd32b175a3282d67a635831cf1c9799214f02cf0597d13a3`

The archive is approximately 2.4 MiB. All 110 files in its `SHA256SUMS` passed
verification, and the standalone E2E verifier passed from the bundle directory.

## API-owned registry and mixed precision (2026-11-02)

`0.2.0-preview.20261102.2` keeps the SDK preset list unchanged. The API supplies
strategy definitions through `createMultiplyClient({ strategies })`; the SDK
supports mixed native token precision and freezes a copy of the discovery
registry. Duplicate IDs and unsupported principal/E-Mode capabilities fail
explicitly. Execution plans use version 2, and version 1 quotes require renewal.

The amount contract was checked against lending source: reserve/user balances and
`availableBorrow` are normalized to nine decimals; `leftSupply` is whole tokens;
coins, flash loans and withdraw/borrow calls use native atoms. Position conversion
rounds collateral down and debt up. Full close converts its execution-time
collateral balance back to native units and rounds the requested withdrawal up
when needed, so the lending contract can clip it to the complete accrued balance.

Verification performed:

- TypeScript no-emit check, Vite package build, changed-source ESLint, and
  `git diff --check` passed.
- `tests/generic.test.ts`: 89 passing deterministic cases across injected 9/6,
  6/9, 8/6 and 9/9 pairs. Coverage includes discovery, all actions' quote/build,
  normalized BCS balance decoding, native capacity, changed prices/decimals,
  precision-impossible targets, registry mutation/duplicates, old-plan rejection,
  and risk reduction after borrowing LTV/capacity is reduced to zero. HF checks
  remain enforced for reducing actions. The supported token precision range is 0–18.
- A deterministic moving-route regression reproduces the stale-bracket solver
  failure and passes after refreshing both endpoints on stalled progress or a
  collapsed interval. The solver permits two refreshes, at most 32 conversion
  evaluations and 45 seconds total; every accepted quote still meets the existing
  1 bp target-leverage tolerance and final risk checks. Stalled converters and
  routes with no achievable target fail explicitly. Representable tiny amounts
  are no longer mistaken for 1x by a price-residual shortcut. Both solver
  directions stop on actual target leverage; withdrawing 90–99% of equity with
  conversion costs is covered for both 6/9 and 9/6 pairs.
- Read-only mainnet market reads passed for both SUI/USDC directions, confirming
  lending v2, limiter, both oracle feeds and both debt-token flash configurations.
- Unsigned mainnet open simulations passed for SUI collateral/USDC debt and
  USDC collateral/SUI debt.
- Composed open→close mainnet simulations passed in both directions (147 and
  135 commands respectively), including on-chain zero collateral and debt
  assertions. The six-decimal collateral test exercises normalized-to-native
  withdrawal and clipping. Simulations use the existing public E2E address; the
  USDC-principal test obtains USDC from a SUI swap inside the simulated PTB.

Raw local evidence: `/private/tmp/multiply-sdk-directional-smoke/`. No signing,
broadcast, package publication or live position change occurred. Market values
are point-in-time observations, not fixed product risk settings.
