# DefiLlama adapters for NAVI Vault (vendored)

This directory holds the DefiLlama listing work for NAVI's `navi_vault`
product on Sui, together with the patches, PR bodies, and the upstream API
change the fees adapter depends on.

**None of the code here runs in this repository.** It is not part of any
workspace package, it is not built, linted, typechecked, or published by
`turbo`, and nothing in `packages/**` imports it. It is vendored source whose
real home is two public DefiLlama repositories.

## One listing, not two

Earlier revisions of this directory proposed two listings, `navi-prime` and
`navi-high-yield`, mirroring the Prime and High Yield tabs on NAVI's Earn page.
That was wrong for DefiLlama and has been collapsed into a single
**`navi-vaults`** listing covering all four production vault objects.

The four vaults share one contract, one curator, one fee recipient and one
owner, and differ only by off-chain curation config. DefiLlama models that as
one `<protocol>-vaults` listing — `projects/moonwell-vaults/index.js` and
`projects/felix-vaults/index.js` each cover a whole family of curated vaults
with differing risk configs under one slug, and `projects/extra-vaults` and
`projects/bonzo-vaults` do the same with explicit vault lists and several
strategy families respectively. "Mirrors our own UI tabs" is not a protocol
boundary. Prime vs High Yield survives only as a per-entry name comment in the
vault array.

Per-vault APY/TVL granularity belongs on DefiLlama's Yields dashboard
(`DefiLlama/yield-server`), not in a second TVL listing.

## Vendored files

| Vendored path | Upstream repository | Upstream path |
| --- | --- | --- |
| `DefiLlama-Adapters/projects/navi-vaults/index.js` | `DefiLlama/DefiLlama-Adapters` | `projects/navi-vaults/index.js` |
| `dimension-adapters/fees/navi-vaults/index.ts` | `DefiLlama/dimension-adapters` | `fees/navi-vaults/index.ts` |

The layout mirrors the upstream paths one-for-one under a folder named after the
upstream repository. The `dimension-adapters` patch additionally adds one line
to upstream's `helpers/env.ts` (see "The fee endpoint parameter" below); that
file is not vendored here, only the patch carries the change.

They are vendored into this repo only because the session that wrote them has no
push access to the DefiLlama repositories: they are not NAVI-owned, so the
GitHub App that authorizes this environment's pushes cannot be installed on
them, and a direct push is refused by the git proxy as a repository outside the
authorized set. Vendoring into a NAVI-owned repository was the remedy that error
names.

**This is a staging area, not the source of truth.** Once the upstream PRs are
open from a fork, the adapters live upstream and this copy should be treated as
a historical snapshot (or deleted).

## How to get the adapters upstream

Both `.patch` files are `git format-patch` output and were verified with
`git apply --check` against `DefiLlama-Adapters` `main` at `f4c1225` and
`dimension-adapters` `master` at `2f6081e`:

```bash
# TVL adapter
git clone https://github.com/<your-fork>/DefiLlama-Adapters
cd DefiLlama-Adapters
git checkout -b navi-vaults
git am /path/to/integrations/defillama/DefiLlama-Adapters-navi-vaults.patch

# Fees adapter (blocked on a NAVI backend change - see below)
git clone https://github.com/<your-fork>/dimension-adapters
cd dimension-adapters
git checkout -b navi-vaults
git am /path/to/integrations/defillama/dimension-adapters-navi-vaults.patch
```

If `git am` rejects a hunk because upstream has moved on, apply with
`git apply --3way`, or copy the adapter file from the mirrored path here and
re-add the `helpers/env.ts` line by hand.

`PR-body-DefiLlama-Adapters.md` and `PR-body-dimension-adapters.md` are the PR
descriptions to paste when opening each pull request. Everything under "Open
items" below has to be reflected there before either PR is opened.

## What the adapters do

**TVL (`projects/navi-vaults/index.js`).** Reads the `total_assets` field off
each of the four `Vault<CoinType>` objects with `sui.getObjects` and adds it
under the coin type taken from the object's own generic type argument. Nothing
is scaled: raw u64 base units is the repo's Sui convention and decimals are
resolved downstream at pricing. A missing object, an unparseable type, or a
missing `total_assets` throws — there is no coin-type fallback and no silent
zero. `timetravel: false`, because these are current-state reads.

`total_assets` is a stored balance the contract refreshes when a market balance
is synced (every deposit and withdraw does so), so it trails lending interest
accrued since that sync. The methodology says "as of that vault's last market
sync" rather than presenting the number as live.

**Fees (`fees/navi-vaults/index.ts`).** Reads NAVI's DefiLlama fee endpoint —
the same endpoint the merged `fees/navi` adapter reads — and sums every vault
group the response reports, so a group NAVI adds later is counted without an
adapter change. The decomposition follows `fees/AGENTS.md`: a management fee is
charged on assets rather than carved out of the interest, so

```
Fees             = gross yield + management fee
Revenue          = management fee + performance fee
SupplySideRevenue = gross yield - performance fee
```

`version: 1`, because the endpoint only serves whole-UTC-day aggregates keyed on
`fromTimestamp`; `pullHourly` is therefore not set (it is unsupported on v1).
This was verified: under `version: 1` the local runner hands the adapter a
day-aligned window (`Sat, 12 Sep 2026 00:00:00 GMT` → `Sun, 13 Sep 2026
00:00:00 GMT`), where under `version: 2` it handed it a rolling one.

No fee rate is hardcoded or asserted: the adapter reads the fee *amounts* from
NAVI's accounting and the methodology says so. The earlier claim that "the
published performance fee is 10% for the USDC vault and 5% for the SUI vault" is
gone — it was stated identically in both per-product files for different
products, and NAVI's own config carries a commented-out "temporarily waived"
line, so which rate is in force was never confirmed.

`dailySupplySideRevenue` cannot go negative by construction: the adapter
rejects a payload where a group's performance fee exceeds its gross yield (a
performance fee is a cut of the yield, so it cannot), and the management fee no
longer enters the supply-side leg at all. That is why there is no
`allowNegativeValue`.

`start` is omitted, per `AGENTS.md` ("if the start cannot be determined, omit it
rather than guess"): the endpoint serves no vault data for any date yet, so no
date can honestly be named as the earliest that returns data. It gets added,
with a refill, once NAVI has backfilled. The vaults went live on Sui on
2026-08-17.

## Double counting

**TVL: `doublecounted: true`, and the justification is now precise.** The vaults
supply into NAVI's own lending markets, which the existing `navi` listing
counts. The overlap is not exact in either direction: `projects/navi/index.js`
reports each market's `total_supply - borrowed`, so the borrowed slice of the
vaults' assets is *not* in that listing's `tvl`, and a vault's `idle_balance`
sits in the vault object rather than in any market. The flag is all-or-nothing,
and flagging the whole book under-reports rather than over-reports, which is the
conservative side. (An earlier revision said flatly that "those assets are
already inside the `navi` listing's TVL", which is not true of the borrowed
slice.)

**Fees: `doublecounted: true`, and this is the one genuinely contested call in
the submission. The PR body must raise it rather than assert it.**

The vaults earn by supplying into NAVI's own lending markets. `fees/navi` books
100% of borrower interest as its `dailyFees` (per DefiLlama's Guiding Principle)
and the lenders' share as its `dailySupplySideRevenue`. The vaults are lenders,
so the vaults' gross yield is a slice of a flow `fees/navi` already reports —
publishing it again as this listing's `dailyFees` would count it twice in chain
and category rollups. `adapters/types.ts` provides `doublecounted` for exactly
that, and `fees/lis-aster/index.ts` uses it in the same shape for a yield
aggregator on top of a listed protocol.

The tension, stated honestly: the flag is **adapter-wide**, so it also keeps
NAVI's genuinely new management and performance fee revenue — revenue that
`fees/navi` misattributes to lenders and never books as NAVI's — out of those
same rollups. `fees/harbor.ts` declines the flag for precisely this reason,
keeping Harbor-only fees in the totals at the cost of overlapping yield. Both
choices lose something. This submission prefers counting nothing twice over
reporting one slice twice, which is also what keeps the fees listing symmetric
with the TVL listing. Maintainers may prefer the reverse; the PR body should ask
which they want rather than presenting the choice as settled.

Both numbers stay fully visible on the listing's own page either way —
`doublecounted` affects aggregation, not the listing.

## Hardcoded vault ids, and the stale-list risk

The four vault object ids are listed explicitly rather than enumerated with
`sui.getObjectsByType`. Two earlier justifications for this are withdrawn:

- The ids were cited to a "deployment descriptor (NAVI's own source of truth)".
  That descriptor lives in NAVI's **private** `navi-open-api` repository and the
  ids appear nowhere in this monorepo, so it is not a source a DefiLlama
  maintainer can open. The comments now cite
  `https://open-api.naviprotocol.io/api/vaults` and the public SDK that reads
  it (`packages/vault`'s `getVaults()`, published as `@naviprotocol/vault`).
  Both are genuinely public: this monorepo is a public GitHub repository and the
  package resolves on the npm registry, both confirmed. The endpoint URL is
  composed from that SDK's committed `OPEN_API_URL`; the endpoint itself could
  not be fetched from this environment, so that it responds as expected is
  inferred from the SDK, not observed.
- The claim that type enumeration would pull in NAVI's staging vaults was
  **false** and has been deleted. Production and stage have different
  `originalPackageId`s, and on Sui the struct type is prefixed by the original
  package id, so a filter on the production type could not have returned stage
  objects.

The real reason is now stated in the code: the session that wrote these adapters
could not reach the vault-list endpoint from its environment, so it could not
verify what that endpoint returns, and an explicit list of ids whose balances
are read on-chain was preferred over a parse of an unverified response.

**Stale-list risk (must be in the PR body).** A vault NAVI launches after this
merges is silently missing from TVL, with no failure signal, until an id is
added to the array. `https://open-api.naviprotocol.io/api/vaults` is the
maintained source to diff the list against. DefiLlama's own guidance prefers
dynamic discovery ("API-assisted discovery is acceptable when the API only
enumerates pools, vaults, markets, token lists, or config; the TVL amount itself
must still come from on-chain"), so expect maintainers to ask for it — and
switching to it is a small change once someone can confirm the endpoint's
response shape. The fees adapter already avoids the equivalent problem by
summing whatever vault groups the endpoint reports.

## Verification status

**Nothing here has been validated against live data.** The environment these
adapters were written and re-worked in has no egress to any Sui RPC, to
`open-api.naviprotocol.io`, or to `coins.llama.fi`: every host answers `403` at
the proxy's CONNECT (`connect_rejected`, organization policy). No TVL figure and
no fee figure has ever been computed. Nothing was stubbed or weakened to force a
check to pass.

What *has* been checked, in fresh clones of both upstream repositories at the
heads named above:

| Check | Result |
| --- | --- |
| `node --check projects/navi-vaults/index.js` | passes |
| `npx eslint projects/navi-vaults/index.js` | passes (exit 0) |
| `node test.js projects/navi-vaults/index.js` | **fails on egress only** — execution reaches `tvl()`, so upstream's `checkExportKeys` already passed (valid chain key, no blacklisted root keys, `timetravel`/`doublecounted`/`methodology` all whitelisted), then `Failed to post https://graphql.mainnet.sui.io/graphql` |
| `pnpm ts-check` (dimension-adapters, with the adapter and the `helpers/env.ts` line in place) | passes (exit 0) |
| `pnpm test fees navi-vaults` | **fails on egress only** — `getEnv` resolves (no `Unknown env key`), the window is day-aligned, then `Request failed with status code 403` from the proxy |
| `git apply --check` for both patches against a clean upstream base | passes |

So the module contracts are proven and the chain read, the endpoint shape, and
every number remain unproven. Before either PR is merged, someone with Sui RPC
access must run:

```bash
# in a DefiLlama-Adapters checkout
node test.js projects/navi-vaults/index.js
```

and confirm the total against NAVI's Earn page. Treat the TVL as unverified
until that run is attached to the PR.

## The fee endpoint parameter

The fees adapter passes a `cf_pass` query parameter to
`open-api.naviprotocol.io`, the same parameter the already-merged upstream
`fees/navi` adapter passes. Nothing beyond parity is claimed for it: NAVI's
handler for this endpoint reads only `fromTimestamp` and never reads, validates
or compares `cf_pass`, and the endpoint is unauthenticated — no token check,
served with `Access-Control-Allow-Origin: *`, and the `internal/` path segment
is a naming convention, not a gate. Whether a Cloudflare edge rule (WAF or bot
management) keys on the parameter is **unverified and unverifiable from any
repository**: that configuration lives in the Cloudflare zone. Because it cannot
be ruled out, the parameter is kept rather than dropped.

The value is **not** committed. The adapter reads it with
`getEnv("NAVI_DEFILLAMA_CF_PASS")`, and the patch adds
`NAVI_DEFILLAMA_CF_PASS` to `ENV_KEYS` in upstream's `helpers/env.ts` — without
that one line `getEnv` throws `Unknown env key` and the adapter fails before
making any request. It is deliberately **not** added to `DEFAULTS`, since a
`DEFAULTS` entry would recommit the literal that this change exists to remove.

Two consequences, both on whoever opens the `dimension-adapters` PR:

1. **The value goes to DefiLlama's maintainers out of band**, for them to set in
   their runtime. Never in the repo, the patch, the PR body, or this file.
2. **The adapter test will be red in DefiLlama's PR CI.** Their CI injects no
   secrets, so the key is unset for the run. Say so in the PR description rather
   than working around it. The precedent for this exact shape is
   `GATESWAP_DEFILLAMA_API_KEY`, added to `ENV_KEYS` only, with no `DEFAULTS`
   entry, in upstream PR #8740.

Note that the fees CI check would be red today even with the value set, because
the data itself does not exist yet — see the next section.

## Open items — neither PR is ready to submit

Nothing in this directory should be described as "ready to submit" while these
are open.

1. **The fees adapter is blocked on a NAVI backend change.** It reads a
   `vaults.<group>` section that `GET /api/internal/defillama/fee` does not
   serve today; the live response covers the lending market only. The adapter
   throws on the missing section rather than reporting `$0`, which is correct
   (`AGENTS.md`: missing data must throw, never return 0 — the refill job caches
   whatever is returned). The required shape and semantics are specified in
   [`navi-open-api-fee-endpoint-spec.md`](./navi-open-api-fee-endpoint-spec.md),
   which still describes two groups; the adapter sums whatever groups are
   returned, so either one combined group or the two documented groups works.
   Until the endpoint ships and has backfilled, the fees PR cannot produce a
   number, and DefiLlama has no "awaiting upstream" state for a PR — a grep of
   the whole repo for a do-not-merge or blocked-on-upstream banner returns
   nothing. The banner that used to sit at the top of the adapter file has been
   removed, along with every comment about being vendored in this monorepo,
   because neither makes sense in the target repository. **Do not open the fees
   PR before the endpoint serves data.**
2. **No live validation** (see "Verification status"). The TVL PR needs a real
   `node test.js` run, and the PR's mandatory "Current TVL" field cannot be
   filled without one.
3. **Logo** is required for a new listing and is still outstanding.
4. **`parentProtocol` cannot be requested in an adapter PR** — it appears
   nowhere in either adapter repository and is set server-side. Grouping
   `navi-vaults` under NAVI alongside `navi` and `astros-perp` has to be asked
   for via `metadata@defillama.com` or a `defillama-server` PR, with a named
   owner. The same applies to the `dimensions: { fees: "navi-vaults" }` wiring
   in `defillama-server`, which is a post-merge follow-up.
5. **Category needs checking against DefiLlama's live category list.** `Yield`
   was claimed; for a vault that auto-allocates deposits into a lending market
   the usual DefiLlama category is `Yield Aggregator`. Not verifiable from this
   environment (`defillama.com` is blocked).
6. **Oracle field should read "Pyth and Supra"**, not Pyth alone — NAVI's
   production market config carries a Supra pair id alongside every Pyth price
   feed id.
7. **Coingecko ID, Coinmarketcap ID and the token field should be left empty.**
   The template says "leave empty if not listed", and the vaults issue no
   transferable token; attaching NAVX to a vault row invites a bogus mcap/TVL
   ratio.
8. **Audit URLs exist and should be pasted** rather than left as TODO (public
   Veridise and Certora reports for the vault, plus NAVI's lending audits), as
   should Treasury, docs link and referral-program answers.
9. **The double-counting question above must be put to maintainers**, not
   answered in a PR-body aside.
