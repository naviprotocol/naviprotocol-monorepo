# SDK Core Live Smoke

This smoke suite is the SDK-level regression gate for Sui SDK v2 transport and
core business flows. It validates built package output in `dist/`, not only
TypeScript source.

## Commands

```bash
pnpm smoke:sdk-core-live:plan
pnpm smoke:sdk-core-live
pnpm smoke:sdk-core-live:execute
```

Default `smoke:sdk-core-live` runs `simulate` mode. It reads a test wallet from
`FE_E2E_SUI_PRIVATE_KEY`, derives the address, and does not print the key.

`execute` mode broadcasts real transactions only when both conditions are true:

- command is `pnpm smoke:sdk-core-live:execute`
- `NAVI_SMOKE_ENABLE_EXECUTE=1` is present

Real transaction execution must still be approved as exact actions before use:
network, wallet address, package, action, amount, and expected side effect.

## Environment

Required:

- `FE_E2E_SUI_PRIVATE_KEY`
- `SUI_GRPC_ENDPOINT`

Recommended for upgrade regression:

- `SUI_GRPC_TOKEN`
- `SUI_GRAPHQL_URL`
- `SUI_JSON_RPC_URL`

Optional:

- `NAVI_OPEN_API_BASE_URL`
- `NAVI_AGGREGATOR_BASE_URL`
- `NAVI_AGGREGATOR_API_KEY` or `API_KEY`
- `NAVI_BRIDGE_BASE_URL`
- `NAVI_BRIDGE_API_KEY`
- `NAVI_SMOKE_ONLY=transport,wallet,lending,aggregator,dca,bridge`
- `NAVI_SMOKE_TRANSFER_MIST`
- `NAVI_SMOKE_LENDING_DEPOSIT_MIST`
- `NAVI_SMOKE_SWAP_MIST`
- `NAVI_SMOKE_DCA_MIST`
- `NAVI_SMOKE_SWAP_TO_COIN`
- `NAVI_SMOKE_DCA_TO_COIN`
- `NAVI_SMOKE_BRIDGE_AMOUNT` (human SUI amount, default `2`)
- `NAVI_SMOKE_BRIDGE_TO_CHAIN` (default `0`, Solana)
- `NAVI_SMOKE_BRIDGE_TO_TOKEN`
- `NAVI_SMOKE_BRIDGE_TO_ADDRESS`
- `NAVI_SMOKE_BRIDGE_BUILD_SIGN=1`

## Coverage Matrix

| Scope | Package | Simulate coverage | Execute coverage |
| --- | --- | --- | --- |
| transport | shared Sui clients | gRPC `listBalances/getBalance/listCoins`, GraphQL balance/history, explicit legacy JSON-RPC `getBalance` | none |
| wallet | `@naviprotocol/wallet-client` | Core dry-run self-transfer through `WalletClient.signExecuteTransaction` | 1 MIST default self-transfer |
| lending | `@naviprotocol/lending` | pools read, oracle update, SUI deposit PTB via Core simulate | small SUI deposit |
| aggregator | `@naviprotocol/astros-aggregator-sdk` | quote, build swap PTB, Core simulate | small SUI swap |
| dca | `@naviprotocol/astros-dca-sdk` | create DCA order PTB, Core simulate | small DCA order creation |
| bridge | `@naviprotocol/astros-bridge-sdk` | Sui-source Mayan quote route; optional build/sign/Core-simulate with `NAVI_SMOKE_BRIDGE_BUILD_SIGN=1` and a funded wallet | skipped by default; requires separate exact bridge approval |

## Intended Regression Use

For normal SDK changes:

```bash
pnpm build
pnpm test
pnpm test:sdk-v2-boundaries
pnpm smoke:sui-v2-transport
SUI_GRAPHQL_URL=https://graphql.mainnet.sui.io/graphql pnpm smoke:sdk-core-live
```

For release candidates, add exact-action execute approval and then run a narrow
execute scope, for example:

```bash
NAVI_SMOKE_ENABLE_EXECUTE=1 pnpm smoke:sdk-core-live:execute -- --only=wallet
```

Bridge execute is intentionally outside the default execute gate because it is
cross-chain, fee-sensitive, and has longer finality semantics.

Bridge build/sign validation is available without broadcasting by setting
`NAVI_SMOKE_BRIDGE_BUILD_SIGN=1`. The wallet must hold enough SUI for the active
Mayan route minimum; the default quote amount is `2` SUI because Mayan routes can
reject sub-minimum quote amounts.
