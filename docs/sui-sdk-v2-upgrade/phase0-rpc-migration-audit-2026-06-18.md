# Phase 0 RPC Migration Audit - 2026-06-18

## Sources

- Official Sui SDK 2.0 migration, `@mysten/sui`, SDK maintainers, JSON-RPC
  migration, dApp Kit migration, agent prompt, gRPC overview, and Address
  Balances docs.
- Local installed `@mysten/sui@2.17.0` docs under
  `node_modules/.pnpm/@mysten+sui@2.17.0_typescript@5.8.3/node_modules/@mysten/sui/docs`.
- Repo source scan over `packages/*/src`, `packages/*/tests`, package manifests,
  Vite configs, and `config/check-sdk-v2-boundaries.mjs`.

## Official Migration Coverage

| Area | Local finding | Action |
| --- | --- | --- |
| ESM / Node 22 / public peer | Five SDK packages already use ESM, Node >=22, and `@mysten/sui >=2.0.0` peer. | Keep as release gate. |
| Old public Sui v1 types | Boundary script blocks `@mysten/sui.js`, `TransactionBlock`, and raw JSON-RPC response leaks. | Keep boundary scan; do not expand public contract back to v1. |
| Client constructors | Current SDK default helper still creates JSON-RPC compat clients. | Migrate high-level options to `network + grpc + graphql? + legacyJsonRpc?`. |
| Core API reads | Main code still calls `getCoins`, `getAllCoins`, `multiGetObjects`, `getObject`, and devInspect/dryRun compat methods. | Migrate主路径 to `client.core.*` and gRPC simulation/execution adapters. |
| GraphQL-only reads | SDK packages do not currently expose Sui-native history/filter/join APIs; service history is NAVI/Open API. | Keep service history on service endpoints; require `graphql` only for future Sui-native history/filter/join. |
| Address Balances | Existing balance/coin code assumes coin-object lists for action building and JSON-RPC total balances for display. | DTO/tests must distinguish total, `coinBalance`, `addressBalance`, and coin-object-only branches. |
| BCS / effects schema | No raw `ObjectBcs`, `ExecutionStatus`, or `unchangedSharedObjects` main-path parser found. | Keep boundary scan; normalize Core transaction unions when execute/simulate migrates. |
| Commands / experimental / schema exports | No implementation import of old `Commands`, `@mysten/sui/experimental`, `Experimental_`, or old GraphQL schema exports found. | No code action now; keep scan terms. |
| Executor result/data | No direct Mysten executor wrapper usage found; SDK DTOs still preserve JSON-RPC result compatibility in type tests. | When executor/core execute is introduced, use `result.Transaction ?? result.FailedTransaction`. |
| zkLogin | No SDK zkLogin address calculation path found. | No code action now. |
| Transaction expiration | Many PTB builders create/build transactions without explicit expiration. | Treat as behavior review gate for each migrated builder; set `None` only where old no-expiration semantics are required. |
| dApp Kit | Copilot still uses legacy dApp Kit; SDK release does not own that migration. | Record as frontend follow-up, not SDK blocker. |

## Third-Party Dependency Audit

| Dependency | Finding | Decision |
| --- | --- | --- |
| `@mysten/sui` | Repo uses `2.17.0`; `2.19.0` upgrades noble/scure/bcs/utils dependencies. | Keep `2.17.0` for this implementation slice because Suilend peers are exact. Re-evaluate only after Suilend/open-api/Copilot smoke. |
| Suilend | `@suilend/sdk@3.0.4` peer locks `@mysten/sui 2.17.0`, `@mysten/bcs 2.0.1`, and Pyth `2.2.0`. | Do not bump Mysten to `2.19.0` blindly. |
| Pyth | Latest `@pythnetwork/pyth-sui-js@3.0.0` still depends on `@mysten/sui ^1.3.0`. | Keep NAVI v2 helper; migrate helper reads to Core API-compatible client. |
| Mayan | `@mayanfinance/swap-sdk@15.0.0` depends on `@mysten/sui ^2.17.0`; `createSwapFromSuiMoveCalls` accepts `ClientWithCoreApi` and returns v2 `Transaction`. | Migrate Bridge to Mayan v15 and remove `@mysten/sui-v1` alias / legacy bytes adapter. |
| Cetus | Local lockfile uses `@cetusprotocol/aggregator-sdk@1.5.8` via Suilend/FlowX; npm latest checked during audit is `1.6.1` and depends on `@mysten/sui ^2.16.3`. | Do not upgrade inside Phase 0; keep as third-party adapter dependency and cover through Suilend/open-api smoke before any bump. |
| Scallop | `@scallop-io/sui-scallop-sdk@2.4.5` npm metadata still depends/peers `@mysten/sui 1.45.2` and `@pythnetwork/pyth-sui-js 2.2.0`. No direct published SDK package dependency was found in the five NAVI release packages. | Treat as not cleanly Sui v2; if open-api uses it, keep isolated as a service-side adapter and do not expose through SDK public API. |
| Haedal | No public npm package named `@haedalprotocol/sdk` or `haedal-sdk` was found during audit; wallet-client has an internal Haedal module implemented with local PTB builders and NAVI HTTP stats. | No third-party SDK upgrade action; migrate local PTB/simulate/execute paths through Phase 1/2 client adapters. |
| FlowX / Bluefin / Aftermath transitive | Suilend pulls FlowX, Bluefin, Cetus and Aftermath. FlowX still pulls `@mysten/sui.js@0.54.1` transitively while also resolving `@mysten/sui@2.17.0`. | Internal third-party dependency risk only; boundary scan must ensure these do not leak into NAVI public declarations or root bundles. |

## Code Scan Summary

- `lending`: `devInspectTransactionBlock`, `getCoins`, `getAllCoins`,
  `multiGetObjects`, Pyth `getObject/getDynamicFieldObject`, and hardcoded
  `https://open-api.naviprotocol.io/api`.
- `wallet-client`: `dryRunTransactionBlock`, `executeTransactionBlock`, portfolio
  balance display paths, and hardcoded Volo/Haedal stats endpoints.
- `astros-aggregator-sdk`: `getCoins`, `getTransactionBlock`,
  `dryRunTransactionBlock`, `executeTransactionBlock`, and hardcoded positive
  slippage open-api endpoint.
- `astros-bridge-sdk`: Mayan v1 `@mysten/sui-v1` alias, legacy build bytes, and
  JSON-RPC execute contract.
- `astros-dca-sdk`: `getCoins` and `dryRunTransactionBlock`.

## Phase 0 Addendum - Boundary And Expiration Scan

The post-audit scan was run over the five release package source trees:

```bash
rg -n "new Transaction\\(|setExpiration|Transaction\\.from|dryRunTransactionBlock|devInspectTransactionBlock|executeTransactionBlock|getTransactionBlock|getObject\\(|multiGetObjects|getOwnedObjects|getCoins\\(|getAllCoins\\(" packages/lending/src packages/wallet-client/src packages/astros-aggregator-sdk/src packages/astros-bridge-sdk/src packages/astros-dca-sdk/src -g '*.ts'
```

### Transaction expiration decisions

No production SDK source currently calls `tx.setExpiration(...)`. Existing PTB builders therefore
inherit the Sui v2 default expiration once they are built by v2 clients. This is a behavior-sensitive
Phase 2 gate, not a reason to block Phase 1:

| Package | PTB creation paths found | Phase 2 decision |
| --- | --- | --- |
| `@naviprotocol/lending` | account, reward, pool, emode, Pyth helper. | For read-only devInspect helpers, build through Core simulation and preserve existing return parsing. For user-signed PTBs, do not add `None` globally; add `setExpiration({ None: true })` only if a test proves upgrade-before behavior required indefinite signing. |
| `@naviprotocol/wallet-client` | balance transfers, swap, lending, Volo, Haedal. | Wallet user action builders should keep v2 default expiration unless existing app flows require delayed/offline signing. Any explicit `None` must be per method and tested. |
| `@naviprotocol/astros-aggregator-sdk` | swap PTB and DEX adapters. | Keep transaction expiration unchanged until execute/dry-run adapter migration; do not introduce global no-expiration behavior for aggregator swaps. |
| `@naviprotocol/astros-bridge-sdk` | Mayan v2 returns a v2 `Transaction`. | Do not mutate expiration in the bridge adapter during Mayan migration; preserve Mayan SDK output plus existing sender/gasBudget adjustments. |
| `@naviprotocol/astros-dca-sdk` | create/cancel DCA order and coin split helpers. | Keep default v2 expiration for user-signed order transactions unless DCA UI smoke shows delayed signing regression. |

### Provider smoke gate

Phase 0 now specifies the live transport smoke command:

```bash
SUI_NETWORK=mainnet \
SUI_SMOKE_ADDRESS=0x... \
SUI_GRPC_ENDPOINT=... \
SUI_GRPC_TOKEN=... \
SUI_GRAPHQL_URL=... \
SUI_JSON_RPC_URL=... \
pnpm smoke:sui-v2-transport
```

The script is `scripts/sui-v2-transport-smoke.mjs`. It is read-only by default and does not read
private-key env vars. It covers:

- gRPC `listBalances`, `getBalance`, `listCoins`, optional `getObject`, optional `getTransaction`.
- gRPC `simulateTransaction` with normal checks and with `checksEnabled: false` plus
  `include.commandResults: true`.
- GraphQL balance/history query.
- legacy JSON-RPC `getBalance` only as deprecated transport evidence.

Missing endpoints are reported by env key name only; token values are never logged.

## Pause Gate Result

No P0/P1 scope change was found before implementation or after the Phase 0 addendum:

- Public target contract remains the existing technical design:
  `NaviSuiClientOptions = network + grpc + graphql? + legacyJsonRpc?`.
- Main paths are not inherently JSON-RPC-only; they need adapter work.
- Mayan v15 keeps the existing Sui-source bridge construction entry point and
  moves it to Sui v2/Core API, so no bridge semantic blocker was found before
  code changes.
- Scallop is not cleanly Sui v2, but it is not a direct five-package release dependency in this
  workspace slice. If open-api relies on it, keep it service-side/internal and do not expose it in
  SDK public contracts.
- Transaction expiration is a method-level Phase 2 behavior gate. No evidence currently requires
  a repo-wide `setExpiration({ None: true })`.

Implementation can proceed with the documented adapter migration. Any live smoke
failure that shows Mayan v15 changes signed bytes, route semantics, or execution
meaning must be recorded and escalated before release.
