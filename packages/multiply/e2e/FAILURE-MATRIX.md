# Multiply verification contract

The public package, real NAVI / Volo / Haedal / Astros endpoints and Sui Move VM
are the live-simulation verification boundary. Registry/quote failure cases also
have deterministic unit coverage; API/frontend fixtures are separate evidence. This is mainnet **simulation**, never a signed/broadcast transaction.

The runner imports the built distribution (or an unpacked npm tarball), saves its
input, quote, unsigned TransactionData bytes, command data and full simulation
response. A passed build is not a passed simulation. Live replay can differ as
shared-object state, prices and liquidity change; saved responses are historical
evidence, not an executable frozen fork.

## Failure inventory before implementation

This partitions the finite API / lifecycle boundary; it is not a claim that all
possible remote failures can be enumerated. Registry parsing, bindings and malformed-response handling also have unit tests.

| Boundary | Failure classes | Required behavior / E2E coverage |
| --- | --- | --- |
| Package | Missing dist/export/types, broken workspace dependencies, tarball cannot import | First red run fails on missing dist; final consumer imports tarball |
| Inputs | Invalid address/type, zero/negative/fractional/overflow amount, invalid leverage/HF/slippage, unknown action/strategy | Typed error before PTB mutation |
| Discovery | Unknown numeric keys, incomplete BCS arrays/objects, duplicate Cap/account, retired ordinary keys, transferred Cap, upstream failure | Registry only; no metadata or legacy scans; unknown/conflicting records fail rather than empty |
| Snapshot | Missing pools/config, stale/invalid oracle, unknown risk parameters, non-strategy assets, negative equity, wrong market/E-Mode | Reject incomplete or incompatible state |
| Integer math | u64 overflow, unsafe JS number, decimals mismatch, fee rounding, nonconvergence, dust, debt interest drift | Exact arithmetic, bounded solver, conservative output and debt bounds |
| Liquidity | Supply/borrow/flash capacity exhausted, amount below protocol minimum, disabled market | No executable quote outside limits |
| Converter | Unsupported pair/direction, no route, upstream error, expired/malformed quote, wrong token/amount, fee/positive-slippage loss, insufficient minimum, delayed claim | Validate identity/amount/output; native candidates first; fallback preserves constraints |
| Multi-leg plan | Per-leg slippage exceeds total budget, costs double-counted, solver uses ideal instead of net conversion, flash repayment shortfall | Compose actual minimum outputs; fail infeasible plans |
| Quote | Expired, serialized/reloaded, changed identity/strategy/action/constraints/plan, converter replaced, state changed since quote | Validate and re-plan against current data without silently changing route |
| PTB | Wrong/missing input coin, over-consuming input, wrong Cap binding, Cap not returned, leftovers lost, missing limiter/oracle update | Astros route change goes to quote.address; remaining results returned to caller; chain guards; full-PTB simulation |
| Lifecycle | First open, empty Cap reuse, add/remove principal, lever up/down, repay, add collateral, full close, missing position | End-to-end action scenarios using real VM state; unsupported paths explicit |
| Atomicity | Swap succeeds but borrow/repay/HF check fails, native instant redemption unavailable, pending assets misused as cash | Whole PTB aborts; delayed settlement unsupported in initial release |
| Uniqueness | Concurrent create, changed registration/owner, duplicate account across keys | Fixed sender/key registration rejects a concurrent duplicate atomically; names are irrelevant; invalid bindings fail |
| Evidence | Missing artifacts, failed simulation marked passed, skipped RPC treated empty, existing output overwritten | Nonzero exit on any required failure; fresh run dir; SHA-256 manifest |

## Lifecycle fixture

Open creates a real AccountCap and position in a simulated PTB. The runner reads
reserve indices, balances and HF in the SAME simulation. Subsequent action
scenarios prepend that real open PTB and inject only the resulting uncommitted
account snapshot, then execute the entire combined PTB in the real VM. The Cap
is passed as a PTB result just as a Vault passes a Cap removed from its container.
This is explicitly not a persisted wallet lifecycle or an on-chain uniqueness
test. No balances, prices, protocol execution or conversion results are mocked.

## Run

`pnpm --filter @naviprotocol/multiply build`

`pnpm --filter @naviprotocol/multiply test:e2e`

Optional: `MULTIPLY_E2E_ADDRESS` (public funded address used for simulation only),
`SUI_GRPC_URL`, `MULTIPLY_E2E_OUT`, `MULTIPLY_E2E_PACKAGE` (tarball consumer entry),
`MULTIPLY_E2E_ONLY` (comma-separated scenario names). No private key is read.

All full transactions use checks enabled; getter probes use checks disabled to
retrieve command results. Both are saved and labelled separately.

## Browser-discovered Haedal minimum regression (2026-10-30)

Before changing the converter, add `small-haedal-fallback`: open with 0.01 SUI
through the default public engine, build the complete NAVI PTB, and simulate it
with all checks enabled. The previous native quote succeeds but the real Haedal
`request_stake_coin` aborts with code 4. This case must fall back to Astros and
complete, while `open-haedal` continues to exercise native Haedal at 1 SUI principal.
Protocol constraints must be checked per conversion input, not per wallet principal.
The official interface declares `MIN_STAKING_THRESHOLD = 1_000_000_000` and
`EStakeNotEnoughSui = 4`:
https://github.com/haedallsd/haedal-protocol-interface/blob/main/sources/staking.move
This is an E2E regression through live protocols, not an isolated converter test.

## Persisted AccountCap discovery regression (2026-10-30)

Before changing discovery, `persisted-position.mjs` reads a real wallet-owned
mainnet Cap through the public built package. It must return that strategy and
Cap exactly once with positive collateral/debt, support the strategy filter,
reject opening a duplicate position, and build/simulate repayment using the
existing Cap. No source or protocol is isolated or mocked. Failure boundaries:
wrong type origin filter, wrong owner or transferred fixture, missing/invalid
metadata, incorrect configured E-Mode, duplicate strategy binding, RPC/getter failure,
empty/closed fixture, existing-Cap ownership/PTB failure. RPC errors fail the run.

Set `MULTIPLY_E2E_POSITION_ADDRESS` and `MULTIPLY_E2E_CAP_ID` to an active vSUI/SUI
Multiply position, then run `node packages/multiply/e2e/persisted-position.mjs`.
Optional `MULTIPLY_E2E_PACKAGE` points to an installed tarball entry. The fixture
is live and must remain active and wallet-owned; no transaction is broadcast.
Evidence uses a fresh output directory with inputs, package hash, chain Cap,
positions, unsigned repayment/simulation and SHA-256 manifest.

## Direct Astros refund policy (2026-11-02)

The clean package consumer uses published Astros 2.0.7 and Lending 2.1.0 without
overrides. `small-haedal-fallback` and `default-fallback` decode every route-refund
recipient and require it to match the Multiply quote owner, even when the PTB has
a different sender configured at build time. Missing, malformed and zero converter
recipients must fail before appending any commands. The rest of the lifecycle
continues to run against the real VM with Astros default fee behavior.

The release bundle also includes `refund-proof.mjs`: a live Astros quote is built
with an additional 1,234,567 MIST input and a recipient distinct from the sender.
Unsigned simulation balance changes must show at least that amount reaching the
recipient. This verifies actual nonzero refund delivery, beyond inspecting command
arguments; it does not broadcast a transaction.

## Configured E-Mode (2026-11-23)

`node packages/multiply/e2e/emode.mjs` only simulates and never broadcasts. It
uses a new Registry version, opens vSUI/SUI at 5x, checks the initialized mode and
Multiply Registry, and recomputes HF using the same simulation's collateral/debt
values. Invalid-mode and failing-final-HF injections must abort at the intended
command, with no created business objects or committed events. Shared object
versions and gas-coin consolidation can change even on failure.

Use `MULTIPLY_E2E_PAIR=usdsui` for USDSUI/USDC. A sufficiently funded native USDC
Coin is required for full simulation; missing funding is an unmet prerequisite,
not a passing scenario. A missing catalogue group exercises targeted configuration
reading from Storage using the actual field type origin, never an account-mode
mapping or the independent E-Mode Registry. Persisted new-version Cap management
and paused-group operations still need chain fixtures; unit/PTB coverage is separate.

## NAVI stage_v2 environment and composite LST prices (2026-11-17)

stage_v2 is a separate NAVI deployment on Sui mainnet (lending original
`0x51e18f…`, v3 `0x64d899…`; oracle original `0x63862c…`, v3 `0xe64be9…`;
limiter v2 `0x7fb801…`). Its `vsui-sui` isolated market (id 8) prices vSUI as
SUI/USD × `VSUI/SUI.RR` (ratio oracle 200). open-api `env=dev` lists the RR
feed under vSUI's own oracle id and coin type, with an extra `ratioOracleId`.
Prod will switch to composite pricing later, so the feed rule applies to prod too.

Listed before implementation:

| ID | Failure | Required behaviour |
|----|---------|--------------------|
| ST-01 | `env` omitted | Exactly the prod reads as before (`run.mjs`, `emode.mjs` unchanged) |
| ST-02 | `env: 'dev'` but one read (market config, pools, main flash config, flash assets, oracle config, configured E-Mode group) still goes to prod | Every read uses the same env; a dev PTB references no prod lending/oracle package or object |
| ST-03 | `env` is not `prod`/`dev` (`test` excluded by ST-17) | `INVALID_ARGUMENT` before any read |
| ST-04 | A custom `dataSource` plus a client `env` (two sources of truth) | `INVALID_ARGUMENT`; env belongs to the data source |
| ST-05 | dev Cap discovery compares against the prod `AccountCap` type | Cap type follows the env (dev `0x51e18f…::account::AccountCap`) |
| ST-06 | dev has no Multiply Registry; creating a Cap would register a stage Cap in the prod registry, or discovery would read the prod registry | Without an explicit `capRegistry`, dev refuses Cap creation and Registry discovery (`MARKET_UNSUPPORTED`); an existing Cap supplied by a custom data source still works |
| ST-07 | Composite asset: only its own feed pushed | Push own feed and its RR feed; without the RR the chain aborts 1502 (shown on stage) |
| ST-08 | Non-composite market (prod today) | Exactly the two own feeds, as before |
| ST-09 | Collateral or debt has no own feed, or two own feeds | `MARKET_UNSUPPORTED` |
| ST-10 | RR entry without the asset's own entry, or two RR entries for one asset | `MARKET_UNSUPPORTED` |
| ST-11 | RR entry carries Pyth fields | Its Pyth feed is refreshed with the others when stale |
| ST-12 | Isolated market reserve ids differ from oracle ids (vSUI reserve 0, oracle 5) | Lending calls use reserve ids, oracle pushes use feed ids; HF and leverage read back correctly |
| ST-13 | stage outflow limit (10 USD/h per market, borrow + withdraw) exhausted | Abort 3200 is reported as an environment limit, never as a pass; amounts kept to about 1–2 SUI |
| ST-14 | Volo stake/unstake below 1 SUI | Covered by the existing converter minimum; amounts chosen above it |
| ST-15 | No SUI flash liquidity on dev main market | `MARKET_UNSUPPORTED` from the existing check |
| ST-16 | Found while running: the Hermes update for the RR feed is published a moment after the checkpoint a simulation runs at; NAVI's `is_oracle_price_fresh` treats a publish time later than the Clock as stale, skips the RR write and the composite read aborts 1502 (measured 2026-11-17: 3 of 10 pushes had a Pyth publish time 26–1122 ms after the Clock; each emitted `oracle_pro::OracleUnavailable` and left ratio 200 unwritten, the other 7 wrote it) | Not an SDK defect and not fixable in Multiply (a fix would fetch Hermes updates a few seconds in the past, inside the lending SDK). E2E runs every simulation 2.5 s after assembling the PTB (`MULTIPLY_E2E_EXEC_DELAY_MS`), as a signed transaction executes after sign + broadcast; it still retries this abort and Hermes 429 at most 8 times and records each retry. Real executions sign and broadcast seconds later, after the Clock has passed the publish time; a pre-sign dry run can still hit it and should be retried once |

### stage_v2 results (2026-11-17, `node e2e/stage.mjs`, 10 pass / 0 fail, no retries)

Report: `e2e/evidence/stage-v2-report.json`. Open 1.2 SUI at 1.5x on `vsui-sui` (stage):
chain HF 2.7900000088 vs quoted 2.790000003; collateral 1.682 vSUI, debt 0.600 SUI; every
call goes to stage lending/oracle/limiter, no prod NAVI id in any PTB. The same open without
the RR push aborts 1502. add_principal keeps HF 2.79 (leverage unchanged), remove_principal
and close succeed (close leaves 0/0). Regression with `env` omitted: `run.mjs` 16/16,
`emode.mjs` 18/18.

## Flash and borrow from the same reserve (2026-11-23, found by vault-strategy SUI_LST LS-07, before the code)

On a main-market strategy the flash loan and the borrow come from the same main-market debt reserve: during an
`increase` the flash is still outstanding when the borrow runs, so the reserve must hold flash + borrow at once. The two
capacity checks were independent (flash ≤ `flash.max`, borrow + fee ≤ `availableBorrow`): SUI_LST rebalance 3.37x → 4.52x
on 2026-11-23 quoted a 3.70M SUI flash and a 3.70M SUI borrow with 5.15M SUI available, and the borrow aborted on chain
(`balance::split` code 2 inside `borrow_with_account_cap_v2`).

| ID | Failure mode | Expected | E2E |
|---|---|---|---|
| LQ-01 | Main-market strategy: flash + borrow + borrow fee exceed the debt reserve's available borrow | `CAPACITY_EXCEEDED` ("flash and borrow from the same reserve") in the quote and again in the execute preflight, before any command | vault-strategy `e2e/sui-lst-multiply.e2e.ts` LS-15 (real SUI_LST position, SDK quote at the uncapped target) |
| LQ-02 | Isolated-market strategy (debt reserve in its own market, flash from main) | The two checks stay independent, as before | Unchanged code path (`strategy.market !== 'main'`); stage_v2 isolated E2E `e2e/stage.mjs` regression |
| LQ-03 | Main-market quote within the combined capacity | Unchanged | vault-strategy LS-02..LS-06 regression |

LQ result (2026-11-23): vault-strategy LS-15 on the live SUI_LST position — an uncapped 3.37x → 4.52x set_leverage
(3.70M SUI flash + 3.70M borrow, 5.15M available) is refused `CAPACITY_EXCEEDED` "Flash and borrow from the same reserve
exceed its available liquidity" before any command (before the change the same quote built and aborted on chain).
Regression: `run.mjs` all pass, `emode.mjs` 18/18, `stage.mjs` 10/10 (the isolated stage_v2 market, LQ-02).

## Leverage tolerance of a small `add_principal` (2026-11-23, found by settlement M3 MS-01, before the code)

`targetReached` accepts a plan when the whole position's leverage is within 0.01% of the target. An `add_principal` with an
explicit `targetLeverage` whose principal is small next to the position is "reached" with no flash at all: the bracket's
first evaluation (F = 0, principal deposited unlevered) already lands inside that band. SUI_LST (≈ 10.8M SUI collateral at
3.37x) on 2026-11-23: a 73 SUI loop-in targeting the leverage legacy reaches got flash 0 / borrow 0 instead of ≈ 257 SUI;
any add below ≈ 300 SUI stays unlevered (10 of the last 16 production loop-ins).

| ID | Failure mode | Expected | E2E |
|---|---|---|---|
| TL-01 | `add_principal` with an explicit `targetLeverage`, principal small next to the position | Precision scales with the principal: the plan's debt-side residual to the target is within 0.01% of the principal's value (or one debt atom), so the principal is levered to the target; F = 0 is accepted only when it meets that bar | vault-strategy LS-16 (≈ 70 SUI loop-in on the live SUI_LST position: borrow ≈ principal × 3.5177) |
| TL-02 | `add_principal` without `targetLeverage` (keep the current leverage) | Unchanged (whole-position tolerance) | `run.mjs` regression |
| TL-03 | `open`, `set_leverage` | Unchanged | `run.mjs`, `emode.mjs`, `stage.mjs` regression; vault-strategy LS-07 / LS-08 |
| TL-04 | The tighter bar cannot be met within the conversion budget (32 quotes, 45 s) | `NO_CONVERGENCE` before any command, never a plan outside the bar | vault-strategy LS-16 records the quote count; converter quotes are deterministic for Volo stake |
| TL-05 | `add_principal` with a target paid in another accepted coin (`inputCoinType` = collateral, phase-one funding, 9f99a83) | The principal's value for the TL-01 bar is the amount priced in the coin supplied, not in the strategy's principal; a small collateral-paid add is levered like a principal-paid one | `run.mjs` `add-principal-collateral-target`: 0.001 vSUI (below the seed position's whole-position band) with `inputCoinType` vSUI and target 2 borrows, and the simulated PTB lands on the target |

TL result (2026-11-23): on the live SUI_LST position (3.37x) loop-ins of 2 / 73 / 1,000 SUI now borrow 7.02 / 256.75 /
3,517.68 SUI (3.508 / 3.517 / 3.518 × principal) and land on the target leverage to 1e-12; before the change 73 SUI borrowed
0. vault-strategy LS-16 (70 SUI, simulated on chain): 3.5227 × principal, leverage 3.3657978 vs target 3.3657978.
Regression: `emode.mjs` 18/18, `stage.mjs` 10/10, `run.mjs` 15/16 — `close-haedal` expects the Haedal converter and today's
quotes pick Astros; the same case fails identically with this change reverted (control run), so it is market-dependent.

Rebased onto `zado/multiply-package` 6327773 (2026-11-23). TL-01 now prices the added amount in `inputCoinType` (the
collateral or the debt). TL-05 result: `add-principal-collateral-target` passes; with the TL-01 bar disabled (control run)
it fails "a collateral-paid add with a target must borrow". Full regression on the rebased branch: unit 216/216,
`run.mjs` 17/17 (`close-haedal` passes on today's quotes), `emode.mjs` 18/18, `stage.mjs` 10/10; vault-strategy
sui-lst-multiply 18/18.

Rebased onto zado's configured E-Mode `818d578` (2026-11-23): our own E-Mode commit is dropped in favour of it; env /
composite feeds (ST), LQ-01 and TL-01..05 are kept. The same-reserve check now sits in `readLiveBuildState`; with `env`
omitted the lending reads get exactly their old options (ST-01, caught by `tests/emode.test.ts`). Results: unit 261/261,
`stage.mjs` 10/10, `emode.mjs` 5/5 with `MULTIPLY_E2E_ADDRESS=0x39c7…d9ba` (the default address `0xc41d…` now holds a
position, so its new-Cap case fails "Use add_principal or set_leverage" — identically on 818d578 alone), `run.mjs` 16/17
(`close-haedal` expects Haedal and today's quotes pick another route — identically on 818d578 alone). vault-strategy
sui-lst-multiply 18/18 on top (SUI_LST, an existing E-Mode 0 account).

## PR #127 review follow-ups (2026-11-23, before the code)

| ID | Failure | Required behaviour | E2E |
|----|---------|--------------------|-----|
| LQ-04 | Deleverage / remove_principal / close on a main-market strategy while the debt reserve sits at its borrow cap (`availableBorrow` ~0, cash still there): the LQ-01 check compares the flash with `availableBorrow` although nothing is borrowed | The same-reserve check applies only when the plan borrows; an exit needs only the flash (`flash.max`, cash) and stays possible, as `withinLtv` already requires for a lowered borrowing cap | vault-strategy `e2e/sui-lst-multiply.e2e.ts` LS-17: the real SUI_LST main-market position with the market's `availableBorrow` set to 0 quotes a flash-only set_leverage down and passes the build preflight (run.mjs strategies are isolated, so the check never applies there); LS-15 keeps the lever-up refusal |
| ST-17 | `env: 'test'` accepted although no AccountCap type (and no deployment facts) are known for it: every Cap discovery and Cap creation fails `MARKET_UNSUPPORTED` | `test` is not an env until its deployment is known: `INVALID_ARGUMENT` like any unknown value | `stage.mjs` ST-03 lists `test` among the invalid envs |
| ST-18 | `createMultiplyClient` without `env` normalizes it to `'prod'` before passing it on, so the default client's lending reads carry `env: 'prod'` (ST-01 says: exactly the old options) | The client passes `options.env` through unchanged; only the data source normalizes it | not observable on the wire (lending builds the same URL); unit test `tests/emode.test.ts` asserts the default client's lending read options |
| ST-19 | The env Registry assertion for a created Cap runs after `prepareOracle` and `create_account` were appended: a refused `buildPTBForSimulation` of a stored create-quote (prod quote, dev client without `capRegistry`) leaves the caller's PTB mutated | Refused before any command, with the other preflight checks | `stage.mjs` ST-19: a prod create-quote given to a dev client's `buildPTBForSimulation` fails `MARKET_UNSUPPORTED` and the PTB has no commands |

Review follow-up results (2026-11-23), each case failing before the fix and passing after it:
- LQ-04: vault-strategy LS-17 — before: SUI_LST set_leverage 4.036x → 3.786x at `availableBorrow` 0 refused "Flash and
  borrow from the same reserve exceed its available liquidity"; after: quoted (flash 533,948 SUI, borrow 0) and the build
  preflight passes. LS-15 (lever-up beyond the reserve) still refused.
- ST-17: `stage.mjs` ST-03 — before: `env: 'test'` accepted; after: `INVALID_ARGUMENT` (8 invalid values).
- ST-18: `tests/env-wiring.test.ts` — before: the default client handed the data source `env: 'prod'`; after: unset.
- ST-19: `stage.mjs` ST-19 — before: commands appended before the `MARKET_UNSUPPORTED` refusal; after: none.
Regression: unit 263/263, `stage.mjs` 11/11, `emode.mjs` 5/5 (address override), `run.mjs` 16/17 (`close-haedal`
market-dependent, as above), vault-strategy sui-lst-multiply 19/19.

## PR #127 review, second round (alexayan, 2026-11-24, before the code)

**Same-reserve capacity is two limits, not one.** NAVI's borrow-cap check (`validate_borrow`, abort 1605) uses the
reserve's accounting (total borrow + amount against total supply × borrow cap); a flash loan moves coins out of the pool
without touching that accounting. The pool's coins must cover everything withdrawn while the flash is outstanding
(`balance::split`, abort 2). LQ-01 compared flash + borrow + fee with `availableBorrow`, the borrow-cap headroom, not
cash: SUI main on mainnet 2026-11-24 has 5.05M SUI headroom and 5.94M cash, stage_v2 main WBTC 561 sats and 1,146. The
LQ-01 abort (`balance::split` inside the borrow) was the cash running out. Today headroom ≤ cash on every prod and stage
main reserve, so the old check was stricter than the chain (refusals, never an aborting PTB); with the borrow checked
against headroom alone, the cash check is what keeps flash + borrow possible.

Cash is the lending API's `balance` ("pool withdrawable balance", raw in the coin's decimals; `availableBorrow` is
lending's 9-decimal amount). It is not the `Pool<T>` object's balance: the SUI pool stakes most of its SUI and unstakes on
withdrawal — prod holds 1.0M SUI liquid against an API balance of 5.94M, and a 2M SUI flash simulates successfully
(2026-11-24). The API value can lag the chain by a few atoms (stage WBTC: 1,136 vs 1,146), like `availableBorrow`; the
build simulation stays the final check. The borrow fee is counted as a cash outflow too (conservative by at most the fee).

| ID | Failure | Required behaviour | E2E |
|----|---------|--------------------|-----|
| LQ-05 | Main-market plan with cash for flash + borrow but little borrow headroom (borrow + fee ≤ `availableBorrow` < flash + borrow + fee ≤ cash) is refused `CAPACITY_EXCEEDED` although the chain accepts it | Quoted and built: borrow + fee is checked against `availableBorrow`, flash + borrow + fee against cash | `stage.mjs` LQ-05: on stage_v2 main WBTC (real chain, simulation, about 1 USD so stage's outflow limit stays out of the way), a raw PTB flash-loans and borrows from the same reserve with flash + borrow above the headroom and borrow below it: it succeeds (a flash does not use headroom). Unit: alexayan's fixture (supply 1000, borrowed 700, cap 78%: headroom 80, cash 300; 100 at 1.5x → flash 50, borrow 50) quotes and builds |
| LQ-06 | Once the borrow is checked against headroom alone, flash + borrow + fee above cash (borrow within headroom) would pass the quote and the preflight and abort on chain | `CAPACITY_EXCEEDED` at the quote and again in `readLiveBuildState`, before any command | `stage.mjs` LQ-06: flash + borrow one atom above the WBTC pool's cash, borrow within headroom: the borrow aborts in `balance::split`. Unit: cash one atom below flash + borrow + fee refused at quote and build; exactly equal passes |
| LQ-07 | Units: `debt.balance` is raw in the coin's decimals, `availableBorrow` is lending's 9-decimal amount; mixing them is off by 10^(9−d) | Cash compared raw-to-raw with the plan amounts; headroom converted with `lendingToRaw` as before | Unit: LQ-05 / LQ-06 for every decimal pair of `generic.test.ts` (9/6, 6/9, 8/6, …), at the exact boundary |
| LQ-08 | The headroom check stays: borrow + fee > `availableBorrow` with ample cash | `CAPACITY_EXCEEDED` (unchanged) | `stage.mjs` LQ-08: a WBTC borrow 10 sats above the headroom, cash to spare, aborts in `validate_borrow` (1605). Unit: headroom one atom below borrow + fee refused at quote and build; exactly equal builds |
| LQ-09 | Cash missing or not an unsigned integer in the snapshot (custom data source, API without `balance`) | Fail closed `READ_FAILED` for a main-market plan that withdraws anything, before any command | Unit: `balance` deleted / `'1.5'` / `'-1'` |
| LQ-10 | Flash-only exit (LQ-04) bounded only by `flash.max`, a configured maximum, not by cash | The exit's flash is checked against cash too; at the borrow cap with cash left it stays possible (LQ-04) | vault-strategy LS-17 unchanged (passes). Unit: flash-only set_leverage down with headroom 0 passes; with cash below the flash refused |

**Stored quotes are not bound to a NAVI env.** `buildPTBForSimulation` takes `q.execution.market` (prod package,
storage, pools) as it is, and nothing in the quote says which env produced it, so a prod quote is assembled by a dev
client (and the other way round) — the default `prepareOracle` then reads the client's own env, mixing two deployments
in one PTB. ST-19 covered only a created Cap without `capRegistry`.

| ID | Failure | Required behaviour | E2E |
|----|---------|--------------------|-----|
| ST-20 | prod quote, existing Cap, built by a dev client (`buildPTBForSimulation` and `buildPTB`) | The quote carries its normalized env (`execution.env`, inside the checksum); both build entries refuse a different env `INVALID_QUOTE` before any command | `stage.mjs` ST-20 |
| ST-21 | dev quote, existing Cap, built by a prod client | Same | `stage.mjs` ST-21 |
| ST-22 | created Cap with an explicit `capRegistry` on both clients (passes the ST-19 Registry check) | Same | `stage.mjs` ST-22 |
| ST-23 | A quote made before this change (no `execution.env`, valid checksum) | `INVALID_QUOTE` "request a fresh quote" | Unit: env removed and checksum recomputed |
| ST-24 | Same-env stored quotes | Build as before | `stage.mjs` lifecycle (dev → dev), unit "builds the same PTB for simulation" (prod → prod) |

ST-19 keeps its assertion that the PTB is untouched; its refusal now comes from the env check (`INVALID_QUOTE`), which
runs first.

Second review results (2026-11-24), every SDK case failing before the fix (`e2e/evidence/review2-unit-before-fix.txt`,
`review2-stage-before-fix.txt`) and passing after it (`review2-after-fix.txt`):
- LQ-05..LQ-10 (unit, 9/6, 6/9, 8/6, 9/9 decimals): before, LQ-05 was refused ("same reserve") and LQ-06 / LQ-09 /
  LQ-10 were not; after, all pass at the exact boundaries.
- Chain model, `stage.mjs` on stage_v2 main WBTC (headroom 561 sats, pool cash 1,146, API balance 1,136): LQ-05 flash
  405 + borrow 448 = 853 (above the headroom) succeeds; LQ-06 flash 699 + borrow 448 = 1,147 (one above cash) aborts in
  the borrow's `balance::split` (2); LQ-08 borrow 571 aborts in `validate_borrow` (1605). These are raw lending PTBs and
  pass before and after the SDK change.
- ST-20 / ST-21 / ST-22 (`stage.mjs`): before, the quotes carried no env and ST-22 built; after, `INVALID_QUOTE` from
  both entries with the PTB untouched. ST-19 now refuses with `INVALID_QUOTE` (env check first). ST-23 (unit): a quote
  without env is refused.
- vault-strategy sui-lst-multiply 19/19 on the live SUI_LST position: LS-15 (uncapped 6.0x) still refused, now "exceed its
  cash"; LS-17 flash-only exit at `availableBorrow` 0 quotes (flash 533,821 SUI) and passes the preflight.
Regression: unit 298/298, typecheck, lint; `stage.mjs` 17/17; `emode.mjs` 5/5 (main-market vSUI-SUI, address override);
`run.mjs` 17/17 — `close-haedal` passes today; `add-principal-collateral-target` failed once `NO_CONVERGENCE` on the
conversion quotes (TL-04's refusal) and passed on the immediate rerun. settlement `--only MS,BD`: 15 pass, 0 fail, 3 skips
(BD-07/08 retired; BD-04 skips while the Helper claim window is open).
