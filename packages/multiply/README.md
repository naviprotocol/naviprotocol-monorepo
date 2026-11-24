# @naviprotocol/multiply

Composable NAVI Multiply PTBs using a Registry-bound AccountCap. The SDK reads,
quotes and builds transactions; it never signs or broadcasts them.

## Phase 1 model

The application owns product registration. Supply its validated `Strategy[]` to
`createMultiplyClient`. The API's phase 1 directory includes vSUI/SUI, haSUI/SUI,
and USDSUI/USDC. The application passes retired Registry keys alongside the active
strategies so wallet reads skip retired AccountCaps.

A strategy has distinct collateral and debt tokens. `principalCoinType` can equal
either. It is the accounting/default withdrawal unit, independent of the selected
opening input. `acceptedInputCoinTypes` defaults to `[principalCoinType]` and may
contain either or both pair assets. No third-token principal or input is supported.

```ts
import { Transaction } from '@mysten/sui/transactions'
import { createMultiplyClient } from '@naviprotocol/multiply'

// Values come from your reviewed application registry, not wallet input.
const multiply = createMultiplyClient({
  strategies: productStrategies,
  retiredRegistryKeys: retiredProductKeys,
})
const strategy = productStrategies.find(s => s.id === 'main-vsui-sui')!
const quote = await multiply.quote(
  address,
  strategy,
  { type: 'open', inputCoinType: strategy.collateralCoinType,
    amount: '1000000000', targetLeverage: '1.5' },
  { minHealthFactor: '2.0', maxSlippageBps: 50 },
)
const tx = new Transaction()
const built = await multiply.buildPTB(tx, quote, {
  coins: [{ coinType: strategy.collateralCoinType, coin: suppliedVsuiCoin }],
})
if (built.createdAccountCap) tx.transferObjects([built.createdAccountCap], address)
if (built.coins.length) tx.transferObjects(built.coins.map(c => c.coin), address)
tx.setSender(address)
// Caller must simulate before signing. Do not ignore any returned Coin or Cap.
```

## API and amount units

| Method | Behavior |
| --- | --- |
| `getPosition(address, { strategy? })` | Array of registered positions; missing Cap returns `[]`, retained empty Cap returns zero balances. Invalid reads throw. |
| `quote(address, strategy, action, constraints)` | Resolves Cap, reads current market/position and freezes a JSON execution plan. Creates no chain objects. |
| `buildPTB(tx, quote, inputs)` | Rechecks state, fees, Registry, policy constraints and expiry before appending commands. Returns Cap and remaining Coins. |

Amounts are native-precision positive u64 **integer strings**, never JS numbers.
The default source converts NAVI nine-decimal balances into token atoms, rounding
collateral down and debt up. Token decimals 0–18 are supported. Market prices are
USD per whole token; `availableBorrow` remains NAVI-normalized units and
`leftSupply` remains whole tokens. Custom sources must preserve these units.

| Action | Amount unit / output |
| --- | --- |
| `open` | Selected `inputCoinType`, default principal; target leverage required. |
| `add_principal` | Selected SDK `inputCoinType`, default principal; API phase 1 exposes only principal. |
| `remove_principal` | Minimum net principal output, excluding wallet gas; optional target leverage. |
| `set_leverage` | Target leverage only. Returns any route surplus. |
| `repay` | Debt atoms; unused input returned. |
| `add_collateral` | Collateral atoms. |
| `close` | All remaining principal and explicit per-token dust; no amount parameter. |

HF, LTV and solver leverage use **NAVI risk oracle values**. Economic display
valuation belongs to the API and may differ for LST backing. Zero debt has null
HF; empty/non-positive equity has null leverage.

`maxLeverage` bounds leverage at the **minimum** conversion output, at quote, live
rebuild and on chain, with its existing 0.01% rounding band: a target equal to it is
reachable at zero slippage, and a nonzero `maxSlippageBps` needs matching headroom
above the target. It bounds only what can raise leverage: `close`, `repay` and
`add_collateral` are never refused by it, and `remove_principal` or a lowering
`set_leverage` on a position already above it may keep, but not raise, the current
leverage; `add_principal` there is refused, since it adds debt. `repay` and
`add_collateral` stay available without positive
equity, but the result must still meet `minHealthFactor`. A `remove_principal`
target that would need new debt is `ACTION_UNSUPPORTED`. `add_principal` levers
the amount it adds to the target, or to the current leverage when none is given.

For `open` and upward `set_leverage`, target accuracy is a relative **0.1%**:
`abs(actualLeverage - targetLeverage) / targetLeverage <= 0.001`.
This applies to both the first swap candidate and the solver result. Other actions
retain their existing 0.01% target accuracy. Estimates always report the actual
quoted result. Target accuracy never relaxes HF, LTV, the independent
`maxLeverage` band, liquidity limits, or funding conservation checks. A candidate
that fails any of those checks still falls back or fails.

## Astros-only leverage quotes

Default conversions use Astros exact-input quotes and build the saved Astros route.
For vSUI/haSUI, an independent chain-rate reader seeds the amount; protocol oracle
prices still determine leverage, HF and capacity. The hint never supplies executable
outputs. One real quote must pass the unchanged target, minimum-output and risk
checks; otherwise the existing solver continues using Astros. An exit candidate is
reused once as the starting point of the existing correction loop. No persistent
amount memoization disables intentional endpoint refreshes.

The Volo hint reads refreshed supply totals in one read-only PTB; Haedal reads the
chain conversion getter with an integer probe. Hints expire after 5 seconds and
are not cached across requests or epochs. Unavailable/paused getters or zero totals
skip the hint. Native cash, native fees and minimums do not gate Astros routes.
`useRateHints: false` disables seeds without changing execution routing.
`rateHintProvider` may provide a separate custom reader. USDSUI uses a price/fee seed.
Close uses its known full input directly; repay/top-up/direct collateral 1x need no
hint or swap. The shared 45-second/32-call budget and solver precision are unchanged.

Explicit custom converters remain supported, including native snapshot methods;
those methods are never selected by the default client or the API's Astros-only client.
See `e2e/astros-only-benchmark.mjs` for read-only interleaved measurements.

## Execution plan v4

Older plans must be re-quoted. `funding` identifies wallet collateral/debt or no
input. Each `PlannedConversion` extends `ConversionQuote` with `id`, `purpose`
(`input | leverage | repayment | output`) and `source`. Quote fields remain flat.
The current two-asset flows have at most one conversion; arbitrary instruction
graphs and serial multi-leg conversions are rejected. A DEX route may itself have
multiple hops, bounded by the single quoted minimum output.

Collateral input is supplied directly; only borrowed debt is converted. Debt
input may merge with debt flash funding before conversion. A 1x collateral opening
needs no conversion or flash loan. On a collateral-principal withdrawal/close,
only the collateral required for debt repayment is sold; the remainder is returned
as principal. Debt dust remains a separate output.

The builder independently validates funding, conversion roles, projected balances,
repayment math and minimum principal output. Different token types never merge.
`estimate.inputs` defines caller funding. Do not change execution data or reuse an
expired/partially built plan. The checksum detects mutation; it is **not** a
signature or permission to accept untrusted client plans. Open API stores quotes
server-side. The caller must simulate the final composed PTB before signing.

## Converters

The default registry contains Astros only. Optional Volo/Haedal converters remain
available for explicitly configured integrations; their native execution limits
apply only when callers select them. Astros may itself choose native, DEX or mixed
routes. A build uses the saved route and never silently switches providers.
Unknown conversion fees are omitted, never fabricated as zero. Known fees are
marked `includedInExpectedOutput: true`. Optional route metadata describes provider,
hops, pools/DEX and observation time; it is separate from opaque executable data.
Astros fee decoration runs at most once per selected conversion, before the checksum,
and never changes output/minimum amounts. Direct converter consumers can call
`enrichFees(quote)` explicitly. Unknown/mixed-route fees remain unavailable.

Astros is pinned to 2.0.7. Its route change goes directly to `quote.address`, not
the gas sponsor or `built.coins`. Vault integrations must account for that custody
policy or supply another converter. Its numeric builder rejects amounts above JS
safe integer range. When using the converter directly, pass a validated
`{ changeRecipient: address }` as the fourth `buildPTB` argument.

## Registry and injected sources

Keys `(strategyNumericId, strategyVersion)` are permanent execution identities,
unique per registry definition. Never reassign a deployed key to different assets
or market/mode. New Caps are created and registered atomically; close retains the Cap.
Invalid ownership, duplicate Caps/accounts, invalid E-Mode configuration and unknown keys
fail explicitly. Only **explicit** `retiredRegistryKeys` may be skipped; structural,
identity and duplicate checks still run first. Retiring a key does not move funds.

The source and engine must receive identical strategies, retired keys and
`capRegistry`. Custom sources declare `capRegistry`; wrapped Cap resolvers must
bind any supplied transaction-result Cap to the quoted identity/state. Object-ID
overrides must match. Sender must equal quote.address. No wallet scan fallback or
migration of unregistered Caps is performed.

The optional `DataSource.readConsistentPosition(cap, strategy, signal)` capability
is for proven historical valuation: it returns native amounts, accountCapId,
accountOwner, marketKey, stateCheckpoint, stable stateId, completed:true and the
market snapshot. The amounts and accrued interest must come from one completed
chain view, not independent latest reads with an attached checkpoint number.
Respect cancellation. **The default NAVI source does not implement this capability.**
The API consequently reports lifetime yield unavailable until a conforming source
and complete history watermark are available. Basic positions and risk still work.

Custom adapters are trusted application code. Built-in contract deployments target
Sui mainnet; changing only the client URL does not switch those addresses.
Isolated phase 2, third-token inputs and delayed redemption are out of scope.
The exported `strategies.vsuiSui`/`hasuiSui` remain legacy dedicated-market presets
(keys 1:1/2:1); phase 1 products must use the API-owned main-market registry.

## Verification and release

From the monorepo root (Node 24, pnpm 10.1.0):

```sh
pnpm install --frozen-lockfile
pnpm --filter @naviprotocol/multiply test
pnpm --filter @naviprotocol/multiply typecheck
pnpm --filter @naviprotocol/multiply lint
pnpm --filter @naviprotocol/multiply build
```

This preview pins published Lending 2.2.0 and Astros 2.0.7. Package it with `npm pack`
after building; API integration uses an exact local tarball plus lockfile integrity
until npm publication. A local package is not an npm release.

The phase 1 tests exercise both funding relationships, management/close outputs,
threshold fallback and malformed/retired identities. Historical documents under
`docs/` and the existing `e2e/` results concern earlier presets: they do not prove
phase 1 hosted simulation or signed-wallet acceptance. Each product must progress
through open simulation → human sample creation → management simulation → human
management/close, with matching Registry keys and source/artifact revisions.

### Strategy E-Mode

Set `Strategy.emodeId` together with `market` to use that market's E-Mode (ID `0`
is valid). `getMarket()` supplies the configured group's collateral LTV/LT;
debt retains its reserve borrow weight. The data source checks asset direction.

Use a **new Multiply Registry strategyVersion** when switching a strategy's mode,
and retire the previous key through `retiredRegistryKeys`. Existing ordinary Caps
are not migrated. A newly created Cap enters the configured mode in the same PTB,
before Multiply registration and funding. A previously initialized Cap, including
an empty one reopened after close, is reused without a mode query or another enter.
No operation reads or writes the independent E-Mode Registry.

Custom DataSources must return `market.emode = { id, active }` for E-Mode strategies,
alongside their effective risk parameters. Paused groups disable new exposure;
the default source can read only that group's configuration to support repayment
and exit, without reading any account's current mode. Keep the existing final-byte
simulation requirement, especially with `buildPTBForSimulation`.

### Market-price and native-exit optimization

`marketPriceMode` defaults to `live` for existing SDK callers. `prefer-market`
uses `Pool.oracle.freshness` only when both strategy assets have coherent,
validated, unexpired evidence for the configured NAVI deployment; otherwise it
uses the existing live oracle path. `market-only` fails with
`PRICE_DATA_UNAVAILABLE` instead of preparing/updating the oracle. Price expiry
also bounds the quote expiry. An expired calculation is replanned once with live
prices only in `prefer-market`, within the original request budget.

Default exits now use the independent rate hint plus a real Astros quote; the prior
native redemption cash-gated fast path is not selected. Explicit native integrations
can still use their snapshot helpers. API `MULTIPLY_DISABLE_RATE_HINTS=true` disables
hints only and never restores native execution.

`prepareOracleForSimulation: false` applies **only** to
`buildPTBForSimulation`. It omits oracle preparation/update commands. The caller
must run the complete checks-enabled transaction simulation and reconcile funding
before exposing signing bytes. Public `buildPTB` keeps its existing oracle and
preflight behavior. No-update builds can fail on expired on-chain prices even if
a live quote succeeded by updating prices inside a read-only simulation. Requoting
does not itself update on-chain prices.

Read-only regression tools:

- `e2e/exit-snapshot-benchmark.mjs`: interleaved native/DEX solver comparison, plus
  real wallet exit simulations. Synthetic positions used for solver timing are
  explicitly separate from the wallet section.
- `MULTIPLY_REFERENCE_ORACLE=true` is an **E2E-only** fixture that explicitly adds
  an oracle update inside simulation. It is never enabled by the API and does not
  prove a no-update build succeeded on current chain state.
