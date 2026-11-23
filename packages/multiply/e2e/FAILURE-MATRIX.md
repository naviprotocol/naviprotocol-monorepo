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
| ST-03 | `env` is not `prod`/`dev`/`test` | `INVALID_ARGUMENT` before any read |
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
