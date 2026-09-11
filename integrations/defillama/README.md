# DefiLlama adapters for NAVI Vault (vendored)

This directory holds the DefiLlama listing work for the two `navi_vault` vault
groups on Sui — **Prime** (blue-chip: USDC Prime, SUI Prime) and **High Yield** —
together with the patches, PR bodies, and the upstream API change they depend on.

**None of the code here runs in this repository.** It is not part of any
workspace package, it is not built, linted, typechecked, or published by
`turbo`, and nothing in `packages/**` imports it. It is vendored source whose
real home is two public DefiLlama repositories.

## Why it lives here

The four adapter files belong upstream in:

| Vendored path | Upstream repository | Upstream path |
| --- | --- | --- |
| `DefiLlama-Adapters/projects/navi-prime/index.js` | `DefiLlama/DefiLlama-Adapters` | `projects/navi-prime/index.js` |
| `DefiLlama-Adapters/projects/navi-high-yield/index.js` | `DefiLlama/DefiLlama-Adapters` | `projects/navi-high-yield/index.js` |
| `dimension-adapters/fees/navi-prime/index.ts` | `DefiLlama/dimension-adapters` | `fees/navi-prime/index.ts` |
| `dimension-adapters/fees/navi-high-yield/index.ts` | `DefiLlama/dimension-adapters` | `fees/navi-high-yield/index.ts` |

The directory layout mirrors those upstream paths one-for-one, under a folder
named after the upstream repository, so each file's destination is obvious.

They are vendored into this repo only because the session that wrote them has no
push access to the DefiLlama repositories: they are not NAVI-owned, so the
GitHub App that authorizes this environment's pushes cannot be installed on
them, and a direct push is refused by the git proxy as a repository outside the
authorized set. Vendoring into a NAVI-owned repository was the remedy that
error names. This repository was chosen because it already owns
`packages/vault` — the `navi_vault` client the adapters describe — so the vault
object ids, field names, and fee semantics below can be reviewed against the
package in the same tree.

**This is a staging area, not the source of truth.** Once the upstream PRs are
open from a fork, the adapters live upstream and this copy should be treated as
a historical snapshot (or deleted).

## How to get the adapters upstream

Both `.patch` files are `git format-patch` output, so they apply with `git am`
from a fork of the corresponding upstream repository:

```bash
# TVL adapters
git clone https://github.com/<your-fork>/DefiLlama-Adapters
cd DefiLlama-Adapters
git checkout -b navi-vault-tvl
git am /path/to/integrations/defillama/DefiLlama-Adapters-navi-prime-high-yield-vaults.patch

# Fees adapters (blocked — see below)
git clone https://github.com/<your-fork>/dimension-adapters
cd dimension-adapters
git checkout -b navi-vault-fees
git am /path/to/integrations/defillama/dimension-adapters-navi-prime-high-yield-vaults.patch
```

If `git am` rejects a hunk because upstream has moved on, apply with
`git apply --3way` instead, or just copy the files from the mirrored paths in
this directory — each adapter is a single self-contained file with no new
dependencies.

`PR-body-DefiLlama-Adapters.md` and `PR-body-dimension-adapters.md` are the PR
descriptions to paste when opening each pull request. They carry the
methodology, the double-counting rationale, and the reviewer-facing reasoning
that DefiLlama's maintainers ask for.

## Status

**TVL adapters (`DefiLlama-Adapters/projects/...`) — ready to submit.** They read
`total_assets` off the hardcoded production vault objects and are marked
`doublecounted: true`, because the vaults supply into NAVI's own lending markets
which the existing `navi` listing already counts.

**Fees adapters (`dimension-adapters/fees/...`) — blocked on a NAVI backend
change.** They read a `vaults.<group>` section that does not exist yet on
`GET /api/internal/defillama/fee` in `navi-open-api`. The live response covers
the lending market only. The adapters deliberately **throw** on the missing
section rather than reporting `$0`, so they cannot be merged until the endpoint
ships the new fields. The exact required shape, field semantics, where the
values must come from, and the on-chain state behind them are specified in
[`navi-open-api-fee-endpoint-spec.md`](./navi-open-api-fee-endpoint-spec.md).
That change is owned by the NAVI backend team and is the one prerequisite for
the fees PR.

## Verification status — read before submitting

**Nothing here was validated against live chain data.** The session that wrote
these adapters had no reachable Sui RPC endpoint, so the vault objects were
never fetched and no TVL or fee figure was ever computed. What was checked is
static only: the adapters load and their module shape matches what the DefiLlama
runners expect, and the vault ids, coin types, decimals, package ids, and fee
fields were cross-read against NAVI's own deployment descriptor and
`packages/vault`.

Before opening the upstream PRs, someone with Sui RPC access should run each
adapter through the upstream test runner and confirm the numbers against NAVI's
Earn page:

```bash
# in a DefiLlama-Adapters checkout
node test.js projects/navi-prime
node test.js projects/navi-high-yield
```

Treat the TVL numbers as unverified until that run is attached to the PR.

## Note on the fee endpoint parameter

The fees adapters pass a `cf_pass` query parameter to
`open-api.naviprotocol.io`, the same parameter the already-merged upstream
`fees/navi` adapter passes. It is passed for parity with that merged adapter's
request, and nothing beyond that is claimed for it: NAVI's handler for this
endpoint reads only `fromTimestamp` from the query and never reads, validates,
or compares `cf_pass`, and the endpoint is unauthenticated — no token check,
served with `Access-Control-Allow-Origin: *`, and the `internal/` path segment
is a naming convention, not a gate. Whether a Cloudflare edge rule (WAF or bot
management) keys on the parameter is **unverified**: that configuration lives in
the Cloudflare zone rather than in any repo, so only the zone's WAF config can
settle it. Earlier revisions of this file and of the adapter comments called
`cf_pass` an auth parameter and a Cloudflare bypass; both readings were inferred
from its name and neither was verified.

The value is **not** hardcoded here. Both adapters read it with
`getEnv("NAVI_DEFILLAMA_CF_PASS")` from `helpers/env`, which is the mechanism
upstream accepts, and there is no fallback literal in the files. No NAVI token,
key, or parameter value should ever be committed to these adapters — DefiLlama
adapters are public source.

Three things follow from that, and all three are on whoever opens the upstream
`dimension-adapters` PR:

1. **`NAVI_DEFILLAMA_CF_PASS` must be added to `ENV_KEYS` in DefiLlama's
   `helpers/env.ts` as part of that PR.** `getEnv` throws
   `Unknown env key: ...` for any key missing from that committed whitelist, so
   without the whitelist entry both adapters fail before they ever make a
   request. The vendored patch touches the two adapter files only; the
   `helpers/env.ts` line has to be added in the upstream checkout.
2. **The value itself goes to DefiLlama's maintainers out of band**, for them to
   set in their runtime. It is never written into the repo, the patch, the PR
   body, or this file.
3. **The adapter test will fail in DefiLlama's PR CI until a maintainer sets
   it.** Their PR CI injects no secrets, so `NAVI_DEFILLAMA_CF_PASS` is unset
   for the run and the fetch cannot succeed. Expect a red check on the PR and
   say so in the PR description rather than working around it.

The precedent for exactly this shape is `GATESWAP_DEFILLAMA_API_KEY`, which was
moved out of the adapter source and into `helpers/env.ts` in upstream PR #8740;
`helpers/gateswap.ts` reads it the same way these adapters read theirs.
