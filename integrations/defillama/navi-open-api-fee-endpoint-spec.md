# Required change to `navi-open-api`: expose vault fees on the DefiLlama fee endpoint

**Owner: NAVI backend team. The two DefiLlama fees adapters (`fees/navi-prime`,
`fees/navi-high-yield`) cannot be merged until this is live in production.**

## Why

`GET /api/internal/defillama/fee` today returns lending-market numbers only. Its
response object is built at `navi-open-api/src/pages/api/internal/defillama/fee.ts:257-275`
and contains exactly: `from`, `to`, `flashLoanRevenue`, `liquidationRevenue`,
`borrowRevenue`, `borrowInterestRevenue`, `borrowInterestFee`, `naviDailyRevenue`,
`naviDailyFee`. Nothing in it covers `navi_vault` management or performance fees.

The vault fee state does exist on chain — `management_fee`, `performance_fee`
(u64 wad, 1e18), `pending_management_fee_shares` and
`pending_performance_fee_shares` on the `Vault<CoinType>` object, see
`naviprotocol-monorepo/packages/vault/src/protocols/navi/vault.ts:78-96` and the
JSON re-parse at `navi-open-api/src/services/navi-vault-admin/state.ts:159-177`
— but turning accrued *shares* into a per-day USD fee figure requires the
share-price history, which only NAVI's closed-source accounting/reconciliation
service has. So the endpoint is the right place for it, not the adapter.

## The change

Add one new top-level key, `vaults`, to the response object returned at
`fee.ts:257`. Everything already in the response stays byte-identical, so the
merged `fees/navi` adapter is unaffected.

```jsonc
{
  "from": 1755388800,
  "to": 1755475200,
  "flashLoanRevenue": 0,
  "liquidationRevenue": 0,
  "borrowRevenue": 0,
  "borrowInterestRevenue": 0,
  "borrowInterestFee": 0,
  "naviDailyRevenue": 0,
  "naviDailyFee": 0,

  // NEW
  "vaults": {
    "prime": {
      "grossYieldUSD": 1234.56,
      "managementFeeUSD": 0,
      "performanceFeeUSD": 98.76
    },
    "highYield": {
      "grossYieldUSD": 2345.67,
      "managementFeeUSD": 0,
      "performanceFeeUSD": 187.65
    }
  }
}
```

### Field contract

| Field | Type | Semantics |
|---|---|---|
| `vaults` | object, required | Always present. Never `null`, never omitted. |
| `vaults.prime` | object, required | The two Prime (blue-chip) vaults: `0x908c978d…` (USDC Prime) + `0x01236ff6…` (SUI Prime). |
| `vaults.highYield` | object, required | The two High Yield vaults: `0x54359eb5…` (USDC High Yield) + `0x864527a8…` (SUI High Yield). |
| `<group>.grossYieldUSD` | number, required | Gross yield the group's vaults earned over `[from, to)`, in USD, **before any fee is deducted**. This is the "Gross Protocol Revenue" DefiLlama calls `dailyFees`. |
| `<group>.managementFeeUSD` | number, required | Management fee accrued by the group's vaults over `[from, to)`, in USD. `0` is a valid value (see open question on whether a management fee is charged at all). |
| `<group>.performanceFeeUSD` | number, required | Performance fee accrued by the group's vaults over `[from, to)`, in USD. |

### Hard requirements

1. **Units are USD, floats, not base units and not wad.** The adapter calls
   `addUSDValue()` directly on these numbers. Sending base units or 1e18-scaled
   values would silently inflate the listing by orders of magnitude.
2. **Group-level pre-aggregation.** Sum the two vaults of each group server-side.
   The adapter must not need per-vault data, decimals or prices.
3. **Window must match `from`/`to` exactly** — the same UTC-day window the
   existing fields use, derived from `fromTimestamp` at `fee.ts:142-144`. Do not
   return a running total or a rolling 24h figure.
4. **The identity `grossYieldUSD >= managementFeeUSD + performanceFeeUSD` must
   hold** in normal operation. The adapter computes
   `dailySupplySideRevenue = grossYieldUSD - managementFeeUSD - performanceFeeUSD`
   and DefiLlama requires `dailyFees = dailyRevenue + dailySupplySideRevenue`.
   A realized vault loss can legitimately make `grossYieldUSD` negative; say so
   rather than clamping it to 0, and flag it to DefiLlama if it happens.
5. **Historical backfill is mandatory.** Dates from 2026-08-17 (vault launch)
   onwards must return real numbers, because DefiLlama refills history. An
   endpoint that only answers for recent days blocks the listing.
6. **Missing data must be an error, not a zero.** If the accounting service
   cannot produce the window, return a non-2xx / non-zero `code` so the adapter
   throws. A stored `$0` is cached by DefiLlama's refill job and is much harder
   to fix afterwards than a missing day.
7. **Do not waive fees silently.** If a group's performance fee is waived for a
   period, `performanceFeeUSD` should be the amount actually taken (i.e. `0`),
   and `grossYieldUSD` should still be the full gross yield.

### Where the code goes

- Add a fetch alongside `fetchReconciliationDailyRevenue`
  (`fee.ts:133-171`) — e.g. `fetchReconciliationDailyVaultFees(fromTimestamp)`
  hitting the reconciliation service's vault equivalent of
  `/dashboard/revenue/daily`. Reuse `requestWithRetry` (`fee.ts:52-89`) so the
  rate-limit handling matches.
- Call it in `handler` next to the existing reconciliation call at
  `fee.ts:191-200`, and add the `vaults` key to the returned object at
  `fee.ts:257-275`.
- Extend the `ReconciliationDailyData` interface (`fee.ts:31-38`) or add a
  sibling interface for the vault payload rather than widening it with `any`.
- The `FEE_DATA_SOURCE === "sentio"` branch (`fee.ts:201-255`) also needs a
  vault path, or the toggle must be documented as reconciliation-only while the
  vault fields are served. Returning `vaults` from one branch and not the other
  would make the adapter throw intermittently.

### Naming note

`prime` / `highYield` are chosen to match the DefiLlama slugs `navi-prime` and
`navi-high-yield`, which in turn match NAVI's own Earn page tabs
(`frontend-monorepo/apps/lending/src/pages/earn.tsx:47`, `isPrimeVault()` at
`frontend-monorepo/packages/stores/src/services/volo-vault.ts:1349`). If NAVI
decides on a single combined `navi-vaults` listing instead, collapse this to one
group and the adapters merge into one file.
