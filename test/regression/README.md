# SDK Regression Suite

This is the **ongoing regression suite** for the NAVI SDKs — not a one-off
upgrade script. It replaces the four upgrade-era smoke scripts with a single
entry point, `scripts/regression-smoke.mjs`, with `--only` selecting scopes and
`--mode` selecting execution intensity.

> History: this suite consolidates the former `sdk-core-live-smoke` (backbone),
> `sui-v2-transport-smoke` (transport connectivity, now covered by the
> `transport` scope), and `sdk-bridge-route-matrix-smoke` (bridge route matrix,
> merged into the `bridge` scope). The performance benchmark
> `scripts/sdk-transport-benchmark.mjs` remains a separate tool (performance ≠
> functional regression) and is not part of this suite.

## How to run

Entry point: `node scripts/regression-smoke.mjs`. Common npm scripts:

| Command                                  | What it does                                                    |
| ---------------------------------------- | --------------------------------------------------------------- |
| `pnpm smoke:regression`                  | All scopes, `simulate` mode (no transactions broadcast)          |
| `pnpm smoke:regression:plan`             | Print the execution plan only, no requests sent                  |
| `pnpm smoke:regression:execute`          | `execute` mode (requires `NAVI_SMOKE_ENABLE_EXECUTE=1` opt-in)   |
| `pnpm smoke:regression:read`             | Run `read-snapshot` only and diff against the baseline           |
| `pnpm smoke:regression:update-baseline`  | Run `read-snapshot` only and write/overwrite the baseline        |

Scopes (`--only=a,b`, or `NAVI_SMOKE_ONLY`): `transport` / `wallet` / `lending`
/ `aggregator` / `dca` / `bridge` / `read-snapshot`.

The default scope set does **not** include `read-snapshot`; trigger it
explicitly with `--only=read-snapshot` (it has its own baseline mechanism and
exit-code semantics).

### Environment variables

- Transport: `SUI_NETWORK` / `SUI_GRPC_ENDPOINT` / `SUI_GRAPHQL_URL` /
  `SUI_JSON_RPC_URL` / `SUI_GRPC_TOKEN` (+ `SUI_GRPC_HEADER_NAME`).
- Wallet: `FE_E2E_SUI_PRIVATE_KEY` (required except when running
  `read-snapshot` on its own).
- Read-only address: `SUI_SMOKE_ADDRESS` (defaults to `0x439f28…b7e30f`).
- Bridge destination addresses: `FE_E2E_BNB_ADDRESS` / `FE_E2E_SOL_ADDRESS`.

Public-node example (generating the baseline):

```bash
SUI_NETWORK=mainnet \
SUI_GRPC_ENDPOINT=fullnode.mainnet.sui.io:443 \
SUI_GRAPHQL_URL=https://graphql.mainnet.sui.io/graphql \
pnpm smoke:regression:update-baseline
```

## How read-snapshot works: freeze the contract, not live values

`read-snapshot` calls every **public read-only method** of each package,
normalizes the result to a **structural/contract-level shape**, stores it in a
snapshot, and diffs against the baseline. The key design: **record the shape
only, strip all live values**.

For each method it records:

1. **Whether the call succeeded** (`ok`);
2. **The set of field key paths** (collected recursively; arrays contribute the
   shape of their first element only);
3. **The type of the top level and each leaf** (`object` / `array` / `string` /
   `number` / …);
4. **Array population bucket** (`0` / `1` / `2-10` / `10+`).

Stripped (only "key exists + type" is kept, never the value): all concrete
numbers, timestamps, cursors, request ids, digests, versions, balances, prices,
health factors, `amount_out`, etc.

Therefore: **only "fields added/removed / type changed / call failed /
non-empty array became empty" trigger a diff.** Fluctuations in balances,
prices, health factors, route counts, quote amounts, and other live data do
**not** trigger a diff.

### Diff and exit codes

When comparing against the baseline, differences fall into two classes:

- **Regressions → non-zero exit**: missing field (`field-missing`), type change
  (`type-changed` / `scalar-type-changed`), success → failure (`call-failed`),
  non-empty array became empty (`array-emptied`).
- **Non-blocking changes (warnings) → exit 0, report only**: new field
  (`field-added`), empty array became non-empty (`array-filled`), method
  added/recovered.

Tolerance detail: a `null` / `undefined` leaf on either side acts as a
wildcard, so **nullable fields never false-positive**.

## Updating the baseline

Baseline file: `test/regression/baseline/read-snapshot.json` (deliberately
outside any upgrade-specific directory). The file contains only `version` /
`generatedAt` / `methods`; the diff compares `methods` only.

**Update the baseline only when the SDK's public read API actually changed
(fields added/removed, types adjusted, methods added/removed):**

```bash
pnpm smoke:regression:update-baseline    # regenerate
git diff test/regression/baseline/        # review: does the diff match this SDK change?
```

Commit the baseline together with the code change after review.
`SNAPSHOT_VERSION` is bumped only when the normalization contract itself
changes (an old baseline then fails fast on the version mismatch instead of
being compared against an incompatible shape).

## Maintenance model

- **Zero day-to-day maintenance**: live data fluctuations never trigger a
  diff; repeated runs locally/in CI should stay at `diff=0`.
- **Update the baseline only on SDK API changes**: if a public read method's
  return structure changes, regenerate the baseline and review it.
- Methods that cannot run (wallet or special input required) are marked
  `skipped` with a reason — they neither enter the baseline nor block the run.
  Methods that genuinely error are recorded as `ok:false` in the baseline
  (repeat runs stay consistent, no false regression).

## Not in CI yet (interface reserved)

The suite already satisfies the two prerequisites for CI: **command-line
invocation** (npm scripts above) and **exit-code semantics** (regression →
non-zero exit). Before wiring it up, CI needs a read-only node endpoint and
(optionally) a read-only address; `read-snapshot` runs without a wallet
private key, making it a good first CI gate.
