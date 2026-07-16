# Sui SDK v2 Upgrade (Acceptance Record)

Last updated: 2026-06-22 (consolidated 2026-07-16)

> **Note (2026-07-16):** This is the single historical record of the v1→v2
> upgrade (the former plan / gRPC-adaptation design / transport-benchmark docs
> were folded into the summary below). The one-off upgrade smoke scripts
> referenced below (`smoke:sui-v2-transport`, `smoke:sdk-core-live`,
> `smoke:sdk-bridge-routes`) have since been consolidated into a single ongoing
> regression suite — `pnpm smoke:regression*` (`scripts/regression-smoke.mjs`).
> For day-to-day regression, see
> [`test/regression/README.md`](../test/regression/README.md), not the commands
> quoted here (kept verbatim as the original evidence).

## Upgrade Decision Summary

- v2 is a full Sui SDK 2.x line — `@mysten/sui@2` public peer, Node.js 22+,
  ESM, v2 `Transaction` and NAVI DTOs — not a compatibility shim. Business
  semantics stay aligned with v1 unless an explicit fix is documented.
- Transports are explicit, with no implicit public-endpoint fallback: `grpc`
  is the release main path (reads, simulate, execute), `graphql` is optional
  for Sui-native history/filter/join semantics, and `legacyJsonRpc` exists
  only as a deprecated compatibility capability.
- Transport performance was benchmarked during acceptance (tool still
  available: `pnpm benchmark:sdk-transport`). gRPC met the main-path budget;
  revisit the GraphQL/gRPC boundary only if gRPC regresses beyond the gate
  (p50 > 1.3x or p95 > 2x vs JSON-RPC).

## Current Status

The SDK package migration is SDK-level acceptance ready for review. The release
main paths now use explicit Sui v2 gRPC/Core clients, GraphQL is covered as an
optional capability, and remaining JSON-RPC usage is limited to explicit
`legacyJsonRpc` compatibility or documented third-party adapter boundaries.

Cross-repo open-api and Copilot validation remains a separate integration gate
because those repos can have their own baseline or UI parity failures.

| Area                     | Status | Evidence                                                                                                                                                                                                                                                                                |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK package build        | Passed | `pnpm build` passed for `lending`, `wallet-client`, `astros-aggregator-sdk`, `astros-bridge-sdk`, `astros-dca-sdk`, and docs. Docs still emit existing typedoc/Next warnings.                                                                                                           |
| SDK package tests        | Passed | `pnpm test` passed: Aggregator 6 passed / 1 skipped, Bridge 16 passed, DCA 11 passed, Lending 53 passed / 51 skipped, Wallet 20 passed / 25 skipped.                                                                                                                                    |
| Type compatibility       | Passed | `test:types` passed for Aggregator, DCA, Lending, and Wallet. Bridge has no `test:types` script; its package build generated declarations successfully.                                                                                                                                 |
| SDK v2 boundary scan     | Passed | `pnpm test:sdk-v2-boundaries` passed after build output generation.                                                                                                                                                                                                                     |
| gRPC / GraphQL transport | Passed | `pnpm smoke:sui-v2-transport` covered gRPC `listBalances/getBalance/listCoins/getObject/simulateTransaction`, GraphQL balance/history, and explicit legacy JSON-RPC `getBalance`.                                                                                                       |
| Core live simulate smoke | Passed | `pnpm smoke:sdk-core-live` passed transport, wallet self-transfer simulate, lending deposit simulate, aggregator swap simulate, DCA create-order simulate, and Bridge quote.                                                                                                            |
| Mayan v2 route matrix    | Passed | `pnpm smoke:sdk-bridge-routes` passed Sui -> Arbitrum USDC with gRPC build client and Sui -> Solana USDC with explicit `legacyJsonRpc` build client, then gRPC/Core simulation of signed bytes. The gate asserts Mayan provider, route token/chain, non-empty bytes, and one signature. |
| Real execute smoke       | Passed | Small mainnet executes were completed for wallet, lending, aggregator, DCA, and bridge source transaction; see digest list below.                                                                                                                                                       |

## Latest Verification

Deterministic gates run on 2026-06-22:

```bash
pnpm test
pnpm build
pnpm test:sdk-v2-boundaries
pnpm --filter @naviprotocol/astros-aggregator-sdk test:types
pnpm --filter @naviprotocol/astros-dca-sdk test:types
pnpm --filter @naviprotocol/lending test:types
pnpm --filter @naviprotocol/wallet-client test:types
```

Live provider gates run on 2026-06-22 with public mainnet endpoints:

```bash
SUI_NETWORK=mainnet \
SUI_GRPC_ENDPOINT=fullnode.mainnet.sui.io:443 \
SUI_JSON_RPC_URL=https://fullnode.mainnet.sui.io:443 \
SUI_GRAPHQL_URL=https://graphql.mainnet.sui.io/graphql \
SUI_SMOKE_ADDRESS=0x439f285f559997df4b4ad42c282581b1ca991631ab020a29c8031a0849b7e30f \
pnpm smoke:sui-v2-transport

SUI_NETWORK=mainnet \
SUI_GRPC_ENDPOINT=fullnode.mainnet.sui.io:443 \
SUI_JSON_RPC_URL=https://fullnode.mainnet.sui.io:443 \
SUI_GRAPHQL_URL=https://graphql.mainnet.sui.io/graphql \
pnpm smoke:sdk-core-live

SUI_NETWORK=mainnet \
SUI_GRPC_ENDPOINT=fullnode.mainnet.sui.io:443 \
SUI_JSON_RPC_URL=https://fullnode.mainnet.sui.io:443 \
pnpm smoke:sdk-bridge-routes
```

## Real Execute Evidence

These small mainnet execute gates were run with the test wallet private key read
from env and never printed:

| Package                               | Action                                           | Digest                                         |
| ------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `@naviprotocol/wallet-client`         | 1 MIST SUI self-transfer                         | `2UuNTqbNniTBp7TxAPEbdWfMyY1GLGNw2T99hc6XVnMP` |
| `@naviprotocol/lending`               | 10,000,000 MIST SUI deposit                      | `D8v2H7tapMAjAFeB2a5j7ddPzRB7r4sTAKqsbVxxT7EB` |
| `@naviprotocol/astros-aggregator-sdk` | 10,000,000 MIST SUI -> NAVX swap                 | `3PwZS6VDvB3q1Q7XNERp97idyqS9bSAkspRzw9wzEi39` |
| `@naviprotocol/astros-dca-sdk`        | 10,000,000 MIST DCA order creation               | `3dQrcD9ixdugnGxJTVrMaAWRi6zm3HkvrHt4zQwroUjP` |
| `@naviprotocol/astros-bridge-sdk`     | Mayan v2 Sui -> Arbitrum USDC source transaction | `5jUwMv78rj4fuw5yHnozN8RiQSRUv91jL3pXrujEqDAv` |

The bridge transaction reached Mayan completed status with destination
transaction `0x1425b783c97d247bc9f98e5ba353eb6f915aad1d39cd4024c5949d82083f6232`.

## Review Closure Items

The 2026-06-22 cross-review found and closed these SDK-level migration risks:

- gRPC token headers were not passed as grpc-web metadata. `NaviSuiClientOptions.grpc.headers`
  and smoke scripts now construct `GrpcWebFetchTransport({ meta })`.
- Mayan Bridge route matrix could previously skip or validate the wrong target.
  It now requires destination addresses, requires target USDC, and asserts
  Mayan provider, route source/destination chain and token, non-empty
  transaction bytes, and one signature.
- Bridge Sui execution now normalizes v2 Core and legacy-compatible execution
  result shapes, and waits by digest instead of passing a transport-specific
  result object back into `waitForTransaction`.
- DCA non-SUI funding now supports Core `listCoins` objects that expose
  `objectId` instead of legacy `coinObjectId`.
- Pyth helper now parses normalized Core table types such as
  `0x000...0002::table::Table<...>` instead of hard-coding `0x2`.
- Address Balances now forwards `cursor` / `limit` and maps Core `cursor` back
  to the SDK `nextCursor` shape.

## Residual Risks

- Bridge Sui -> Solana USDC still requires explicit `legacyJsonRpc` as the
  Mayan third-party build client for route construction. This is an internal
  third-party adapter boundary; signing, simulation, and execution stay on the
  injected v2 provider.
- open-api and Copilot tarball parity are cross-repo integration gates. They
  should be rerun with the latest SDK tarball before release tagging.
- Real bridge execute is cross-chain and fee-sensitive. Keep it behind exact
  action approval and `NAVI_SMOKE_ENABLE_BRIDGE_EXECUTE=1`.

## Acceptance Checklist

- [x] Node.js 22 deterministic SDK gates pass.
- [x] SDK public entry points use Sui SDK v2 imports.
- [x] Old Sui v1 public types are blocked by boundary scan.
- [x] `lending` main path does not depend on `pyth-sui-js`.
- [x] Pyth helper read path supports Core API.
- [x] Suilend is v3, optional, and lazy.
- [x] Bridge uses Mayan v2 and has no `@mysten/sui-v1` alias.
- [x] Bridge Sui path preserves caller gas semantics unless `gasBudget` is set.
- [x] Aggregator execute result is a backward-compatible superset.
- [x] Address Balances cover total, coin-object, and address balance semantics.
- [x] gRPC, GraphQL, and explicit legacy JSON-RPC provider smoke pass.
- [x] Mayan v2 Sui-source route build/sign/Core simulate passes for gRPC and
      explicit `legacyJsonRpc` route construction.
- [x] Small real execute smoke passed for each SDK release package core flow.
- [ ] Repack latest SDK tarballs and rerun open-api / Copilot integration gates.
