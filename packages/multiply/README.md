# @naviprotocol/multiply

AccountCap-based NAVI Multiply strategy engine for wallets, Auto Vault and Open API.
Default NAVI reads, native Volo/Haedal quotes and Astros fallback are included.
The package builds composable Sui PTBs. It never signs or broadcasts transactions.

```ts
import { Transaction } from '@mysten/sui/transactions'
import { createMultiplyClient, strategies } from '@naviprotocol/multiply'

const multiply = createMultiplyClient()
const positions = await multiply.getPosition(address, {
  strategy: strategies.vsuiSui, // omit to read all configured strategies
})
const quote = await multiply.quote(
  address,
  strategies.vsuiSui,
  { type: 'open', amount: '10000000000', targetLeverage: '2' },
  { minHealthFactor: '1.15', maxSlippageBps: 50, maxLeverage: '3' },
)

const tx = new Transaction()
const input = tx.splitCoins(tx.gas, ['10000000000'])[0]
const built = await multiply.buildPTB(tx, quote, {
  coins: [{ coinType: strategies.vsuiSui.principalCoinType, coin: input }],
})
// Astros route change goes directly to address; the caller handles the remaining assets.
if (built.createdAccountCap) tx.transferObjects([built.createdAccountCap], address)
if (built.coins.length) tx.transferObjects(built.coins.map(c => c.coin), address)
tx.setSender(address)
```

## Public API

| Method | Behavior |
| --- | --- |
| `getPosition(address, { strategy? })` | Always returns an array. Missing Cap → `[]`; existing empty Cap → zero position. Returns Cap, amounts, HF and leverage. |
| `quote(address, strategy, action, constraints)` | Resolves the Cap and reads the snapshot internally. Does not create chain objects. Produces a JSON-serializable estimate and a frozen, versioned execution plan. |
| `buildPTB(tx, quote, inputs)` | Rechecks Cap, market, fees, state drift and expiry, then appends commands. Returns Cap and every remaining Coin for the caller to use. |

Actions: `open`, `add_principal`, `remove_principal`, `set_leverage`, `repay`,
`add_collateral`, `close`. Amounts are **raw integer strings**, never JS numbers.
They use each token's native decimals (supported range: 0–18), including mixed-precision pairs. The
default data source converts NAVI's normalized nine-decimal balances into native
atoms (collateral down, debt up). `MarketSnapshot` prices are USD per whole token;
`Pool.availableBorrow` remains NAVI-normalized units and `Pool.leftSupply` remains
whole tokens. Injected data sources must follow the same contract. Frozen execution
plans now use version 3; earlier quotes must be requested again before building.
Leverage/HF use decimal strings; slippage uses integer basis points. An action
with an `amount` requires a positive u64 value. `set_leverage` takes
`targetLeverage`; add/remove principal optionally take it and otherwise preserve
the current estimated leverage. `close` takes no amount.

`estimate.inputs` defines the required Coin types and amounts. Supply one Coin
per type; the builder splits only the quoted amount and returns its remainder.
Repay overpayment is returned. Removing principal guarantees **at least** the
requested output; any surplus also returns to the caller. `healthFactor: null`
means no debt; `leverage: null` means an empty position or non-positive equity; inspect the returned balances. These ratios use NAVI's
oracle valuation, which can differ from a token's market or redemption value.

`execution` is opaque to callers. Do not modify it, reroute during build or cache
it beyond `expiresAt`. Min outputs include conversion wear/fees before slippage.
The solver recomputes leverage with conversion quotes, flash fees and NAVI borrow
fees. One atomic conversion leg is used per initial-release plan, so the total
slippage budget applies to that leg. Exact integer arithmetic is used throughout.

## Converters and injection

Product strategy registration belongs to the calling application or API. Pass its
validated registry into the client; adding another supported token pair does not
require changing or publishing Multiply. The bundled `strategies` export remains
an optional compatibility preset, not a required allowlist.

```ts
const multiply = createMultiplyClient({ strategies: apiOwnedStrategies })
// Discovery enumerates exactly this registry. quote() accepts a Strategy definition.
const positions = await multiply.getPosition(address)
```

Registry IDs must be unique. The client snapshots the registry on initialization.
Strategies bind a stable ID, market and token types to an AccountCap. Keep mutable
names, display labels and product policies outside that definition. The supported
execution model remains one collateral token, a distinct debt token and principal
equal to debt, with lending v2, a health-factor limiter, main-market flash liquidity
and an immediate converter route. Unsupported capabilities fail explicitly; new
protocol mechanisms require an appropriate adapter rather than a new product ID.

```ts
import {
  createMultiplyClient, createNaviDataSource, voloConverter, haedalConverter,
} from '@naviprotocol/multiply'

const multiply = createMultiplyClient({
  client,
  dataSource: createNaviDataSource({ client }), // optional, or your DataSource
  converters: [voloConverter({ client }), haedalConverter({ client })],
  // fallbackConverter: customConverter, // optional; default is Astros
})
```

A strategy describes tokens and lending market, not a converter. Eligible primary
converters are compared by minimum net output, then stable ID. If none can quote,
the fallback is used. A malformed primary quote fails instead of becoming a
silently accepted route. Volo uses its live `get_amount_out` view; Haedal uses
live conversion views and configured fees. Only immediate Coin → Coin conversion
is supported. Native instant redemption can become unavailable; requesting a new
quote can select the fallback. A build never silently selects another route.

Astros uses the published `@naviprotocol/astros-aggregator-sdk@2.0.7` with its default
fee and positive-slippage behavior. Route change is transferred directly to the
user in `quote.address`, independently of the transaction sender or gas sponsor.
It is not included in `built.coins`. The engine's other remaining coins are still
returned to the caller. Its numeric route builder limits supported amounts to safe
JS integers; larger routes are explicitly rejected. Minimum output, health factor
and flash repayment checks remain enforced; extra fees can cause a PTB to abort
if those bounds cannot be met.

When calling the exported Astros converter directly, pass the real user address as
the fourth build argument: `converter.buildPTB(tx, quote, coin, { changeRecipient: address })`.
A missing, malformed or zero recipient is rejected before appending swap commands.

A custom `DataSource` must supply complete, coherent, verified Cap/position/risk/
price/fee data and prepare the oracle commands for its network. Failures must not
be converted to empty positions. Custom converters and data sources execute
trusted application code. Built-in deployments target **Sui mainnet**; passing a
testnet client alone does not switch their contract addresses.

## AccountCap and Vault integration

Caps are discovered exclusively through the mainnet Multiply Registry. Fixed keys
`(strategyNumericId, strategyVersion)` bind vSUI/SUI to `(1,1)`, haSUI/SUI to `(2,1)`;
Open API additionally configures short SUI as `(3,1)`. Every custom Strategy must
supply a unique `registryKey` with canonical integer strings. The version is below
100000 and the combined key must fit u64; never reassign a key to different assets.

New Caps are created and registered atomically in the opening PTB. The registry
rejects a duplicate key for the same sender. The reader verifies object type,
ownership and accountOwner, rejects duplicate Cap/accounts and E-Mode product Caps.
Names/descriptions are neither read nor written. Unregistered Caps are intentionally
excluded, with no migration or wallet-scan fallback. Close retains the registered Cap.
Invalid or transferred registered Caps fail explicitly rather than creating replacements.

`createNaviDataSource({ client, capRegistry, strategies })` and the engine must share
the same deployment and definitions. A custom DataSource declares its `capRegistry`.
Quote/build bind these settings and the fixed numeric key; transaction sender must
match quote.address. Unknown keys fail with `UNSUPPORTED_REGISTRY_STRATEGY`.

Auto Vault can inject a resolver for wrapped Caps and pass a PTB result through
`inputs.accountCap`. The resolver/caller is responsible for binding that transaction
result to the quoted Cap and snapshot; a transaction result cannot be authenticated
by its JS handle. Plain object-ID overrides must match the quoted ID. The engine
keeps Cap transfer/wrapping and final Coin custody with the caller, except for
Astros route change, which is refunded directly to `quote.address`. Vault integrations
must account for that refund policy or inject a converter with their custody policy.

Open API should retain quotes server-side or authenticate its quote envelope.
The SHA-256 checksum detects accidental mutation; it is **not** a signature or
permission to trust arbitrary client-supplied routes. A composed PTB must be
simulated by its caller before signing. HF, minimum conversion output, requested
principal output and optional maximum leverage are also enforced on chain. Close
reads the current balance in the PTB and asserts that both balances are zero.

## Initial release boundaries

- Built-in strategies: `vsuiSui`, `hasuiSui`, in their dedicated NAVI markets.
  Main-market flash liquidity is independent of the position market.
- Principal must equal debt; collateral must be distinct. The default reader
  currently supports nine-decimal pools. An unsupported E-Mode override is rejected.
- Delayed redemption/claim workflows, generic mixed-asset positions, cross-market
  position aggregation, APY/history and on-chain unique-Cap registration are not
  implemented. The data source checks assets in the selected market; it cannot
  establish exclusive use of a Cap across every other market.
- Source reads and quote→build checks do not lock chain state. Changed liquidity,
  prices or fees can make the transaction abort. Discard a partially built PTB
  after a builder/network error; obtain a fresh quote rather than reuse it.
- Package publication is a separate release step. The implementation is accompanied
  by mainnet simulation evidence, not signed/persisted chain transactions.

## Reproduce

From the monorepo root (Node 24 and pnpm 10.1.0 used for the recorded run):

```sh
pnpm install --frozen-lockfile
pnpm --filter @naviprotocol/lending --filter @naviprotocol/astros-aggregator-sdk build
pnpm --filter @naviprotocol/multiply typecheck
pnpm --filter @naviprotocol/multiply build
pnpm --filter @naviprotocol/multiply test:e2e
```

The test runner was committed before implementation (`57804f1`, with live-schema
fixture corrections in `fba268f`). No unit tests or mocked protocol implementations
were added. See [failure inventory](e2e/FAILURE-MATRIX.md) and [verification notes](docs/verification.md).

Each run writes input, frozen quotes, unsigned transaction bytes, commands, actual
post-operation balances/HF, simulation responses, a report and SHA-256 manifest
under `out/multiply/`. `MULTIPLY_E2E_ADDRESS` selects a **public funded simulation
address**; its key is neither read nor required. Defaults use the public NAVI
oracle sender. `MULTIPLY_E2E_ONLY` selects scenarios; only a complete run constitutes
full-suite evidence. Live chain state and service availability can change results.
The lifecycle fixture is real VM execution with a transient injected snapshot;
it does not prove persisted discovery or concurrent uniqueness.

The packed-package consumer replay is documented in the verification report.

The package pins published Lending 2.1.0 and Astros 2.0.7 dependencies. The clean
package consumer installs only the Multiply tarball locally and resolves these
dependencies from npm, without workspace links or dependency overrides.
