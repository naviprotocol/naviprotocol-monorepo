# Multiply E2E contract (written before implementation)

The public package, real NAVI / Volo / Haedal / Astros endpoints and Sui Move VM
are the verification boundary. No unit tests or mocked protocol implementations
are added. This is mainnet **simulation**, never a signed/broadcast transaction.

The runner imports the built distribution (or an unpacked npm tarball), saves its
input, quote, unsigned TransactionData bytes, command data and full simulation
response. A passed build is not a passed simulation. Live replay can differ as
shared-object state, prices and liquidity change; saved responses are historical
evidence, not an executable frozen fork.

## Failure inventory before implementation

This partitions the finite API / lifecycle boundary; it is not a claim that all
possible remote failures can be enumerated. No isolated subsystem test is planned.

| Boundary | Failure classes | Required behavior / E2E coverage |
| --- | --- | --- |
| Package | Missing dist/export/types, broken workspace dependencies, tarball cannot import | First red run fails on missing dist; final consumer imports tarball |
| Inputs | Invalid address/type, zero/negative/fractional/overflow amount, invalid leverage/HF/slippage, unknown action/strategy | Typed error before PTB mutation |
| Discovery | Pagination, absent metadata, renamed/duplicate Caps, E-Mode registration, transferred/wrapped Cap, upstream failure | Empty is distinct from failure; duplicates/conflicts fail; injectable resolver supports Vault |
| Snapshot | Missing pools/config, stale/invalid oracle, unknown risk parameters, non-strategy assets, negative equity, wrong market/E-Mode | Reject incomplete or incompatible state |
| Integer math | u64 overflow, unsafe JS number, decimals mismatch, fee rounding, nonconvergence, dust, debt interest drift | Exact arithmetic, bounded solver, conservative output and debt bounds |
| Liquidity | Supply/borrow/flash capacity exhausted, amount below protocol minimum, disabled market | No executable quote outside limits |
| Converter | Unsupported pair/direction, no route, upstream error, expired/malformed quote, wrong token/amount, fee/positive-slippage loss, insufficient minimum, delayed claim | Validate identity/amount/output; native candidates first; fallback preserves constraints |
| Multi-leg plan | Per-leg slippage exceeds total budget, costs double-counted, solver uses ideal instead of net conversion, flash repayment shortfall | Compose actual minimum outputs; fail infeasible plans |
| Quote | Expired, serialized/reloaded, changed identity/strategy/action/constraints/plan, converter replaced, state changed since quote | Validate and re-plan against current data without silently changing route |
| PTB | Wrong/missing input coin, over-consuming input, wrong Cap binding, Cap not returned, leftovers lost, missing limiter/oracle update | Caller owns lifecycle; return all results; chain guards; full-PTB simulation |
| Lifecycle | First open, empty Cap reuse, add/remove principal, lever up/down, repay, add collateral, full close, missing position | End-to-end action scenarios using real VM state; unsupported paths explicit |
| Atomicity | Swap succeeds but borrow/repay/HF check fails, native instant redemption unavailable, pending assets misused as cash | Whole PTB aborts; delayed settlement unsupported in initial release |
| Uniqueness | Concurrent create, external rename/transfer, direct contract bypass | SDK detection only; no claim of chain uniqueness without a registry |
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
