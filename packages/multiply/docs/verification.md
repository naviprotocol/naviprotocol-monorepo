# Multiply verification record

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

Clean packed consumer (builds and packs all three modified/local dependencies;
installs into a fresh OS temporary directory with no workspace links):

```sh
pnpm --filter @naviprotocol/multiply test:e2e:package
```

Its output bundle includes three `.tgz` files, package hashes, consumer package
manifest and lockfile, and the complete E2E evidence directory. Run the offline
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
