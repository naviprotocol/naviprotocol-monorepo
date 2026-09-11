<!-- ccr-slack-attribution -->
_Requested by **Elliscope Fang** · [Slack thread](https://navi-protocol.slack.com/archives/C08AXCTBQL9/p1789127777481369)_

> ## ⚠️ DO NOT MERGE YET — blocked on a NAVI backend change
>
> Both adapters read a `vaults` section that NAVI's DefiLlama fee endpoint **does not serve today**. The live endpoint (already consumed by the merged `fees/navi` adapter) covers the lending market only: `flashLoanRevenue`, `liquidationRevenue`, `borrowRevenue`, `borrowInterestRevenue`, `borrowInterestFee`, `naviDailyRevenue`, `naviDailyFee`. Vault management and performance fees are not exposed anywhere public, and the authoritative per-day numbers live in NAVI's closed-source reconciliation service, so they cannot be derived on chain by the adapter.
>
> Until NAVI ships the `vaults` field, every call throws on the missing section. That is deliberate — returning 0 would be cached by the refill job and stored as a real $0 day. **Please hold this PR until NAVI confirms the endpoint change is live in production and backfilled to 2026-08-17.** The exact field contract NAVI has been given is reproduced at the bottom of this description.

Adds fees/revenue adapters for NAVI's `navi_vault` product on Sui, as two listings matching the two TVL listings in the companion `DefiLlama-Adapters` PR: **`navi-prime`** (USDC Prime + SUI Prime) and **`navi-high-yield`** (USDC High Yield + SUI High Yield).

**Before:** DefiLlama showed NAVI fees from the lending market only (`fees/navi`): borrow interest, borrow fees, flash loan fees and liquidation fees. NAVI's vault product, live since 2026-08-17, charges a performance fee on the yield it earns for depositors, and none of that appeared on DefiLlama. A user comparing NAVI's vaults to other Sui yield venues saw TVL with no fee or revenue line at all.

**After:** each listing reports the gross yield its vaults earned (`dailyFees`), the management and performance fee NAVI took from it (`dailyRevenue` / `dailyProtocolRevenue`), and the remainder paid out to depositors (`dailySupplySideRevenue`), so `dailyFees = dailyRevenue + dailySupplySideRevenue` holds per window.

**How:** the adapters call the same `open-api.naviprotocol.io/api/internal/defillama/fee?fromTimestamp=…` endpoint the merged `fees/navi` adapter already uses, and read the new `vaults.prime` / `vaults.highYield` object from it: three USD numbers per group (`grossYieldUSD`, `managementFeeUSD`, `performanceFeeUSD`), aggregated server-side over the same UTC-day window as the existing fields. No fee rate is hardcoded in the adapter — the amounts come from NAVI's accounting, so a rate change or a fee waiver needs no adapter change. The on-chain vault object ids are kept as comments next to the code so the adapter can be rebuilt if the endpoint disappears.

---

##### Name (to be shown on DefiLlama):

`NAVI Prime` (slug `navi-prime`) and `NAVI High Yield` (slug `navi-high-yield`).

##### Twitter Link:

https://twitter.com/navi_protocol

##### List of audit links if any:

- NAVI lending protocol audits (OtterSec, Veridise, MoveBit, Salus): https://github.com/naviprotocol/navi-smart-contracts/tree/main/audits
- The vault contract is audited by Veridise and Certora; `TODO — NAVI to confirm` canonical public URLs for those two vault reports.

##### Website Link:

https://naviprotocol.io — vaults at https://app.naviprotocol.io (Earn). Docs: https://naviprotocol.gitbook.io/navi-protocol-docs

##### Logo (High resolution, will be shown with rounded borders):

`TODO — NAVI to confirm`

##### Current TVL:

`TODO — NAVI to confirm`. No on-chain read was possible while preparing this PR, so no figure is quoted rather than a guessed one. TVL comes from the companion `DefiLlama-Adapters` PR.

##### Treasury Addresses (if the protocol has treasury)

`TODO — NAVI to confirm`. The vaults' curator and allocator address is `0x8f7607fa8c11b81b074c9fa95615742955f91035cd45ab6e4ac9dfd695fef606`; whether the accrued fee shares are claimed to a NAVI treasury, to that curator, or split between them is an open question (see below).

##### Chain:

Sui

##### Coingecko ID:

`TODO — NAVI to confirm` (the vaults issue no transferable share token).

##### Coinmarketcap ID:

`TODO — NAVI to confirm`

##### Short Description (to be shown on DefiLlama):

- NAVI Prime: "Automated lending vaults on Sui that allocate deposits across NAVI's blue-chip collateral markets."
- NAVI High Yield: "Automated lending vaults on Sui that allocate deposits across NAVI's lending markets for higher yield."

##### Token address and ticker if any:

NAVX — `0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX` (NAVI's protocol token, not a vault share).

##### Category \*Please choose only one:

Yield

##### Oracle Provider(s):

Pyth, inherited from the NAVI lending markets the vaults supply into. The fee adapters use no oracle: the endpoint returns USD amounts directly.

##### Implementation Details:

Each rebalance/harvest transaction refreshes the Pyth feeds of the markets it touches before moving funds; the markets' own price oracle objects value collateral.

##### Documentation/Proof:

https://naviprotocol.gitbook.io/navi-protocol-docs — `TODO — NAVI to confirm` a direct docs link for the vault product's fee schedule.

##### forkedFrom:

Not a fork. `navi_vault` is NAVI's own Move contract.

##### methodology:

See the `methodology` and `breakdownMethodology` objects in each adapter. Summary: `dailyFees` is the gross yield the group's vaults earned in the window before any fee; `dailyRevenue` is the management fee plus the performance fee NAVI took; `dailySupplySideRevenue` is the rest, paid to depositors.

##### Github org/user:

https://github.com/naviprotocol

##### Does this project have a referral program?

`TODO — NAVI to confirm`

---

### Pre-answering the standard review questions

- **Is a 0-fee day correct for this protocol?** A genuine $0 day is possible for a vault that is empty or whose performance fee is waived, but a $0 that comes from a missing endpoint window is not: the adapters throw rather than return 0 whenever the `vaults` section or any of its three numbers is absent or non-numeric.
- **Why would the numbers differ from NAVI's own dashboard?** They should not. Both come from the same reconciliation accounting, aggregated over the same UTC-day window keyed on `fromTimestamp`.
- **Did the fee rate ever change?** NAVI's published performance fees are 10% on the USDC vaults and 5% on the SUI vaults, and NAVI's frontend carries a performance-fee rollout notice, meaning fee collection was not continuous from launch. Because the adapters take the fee **amounts** from NAVI's accounting instead of applying a hardcoded rate, a rate change or a waiver period needs no adapter change and no refill. There is one open question here: NAVI's config publishes 10% for USDC High Yield while a commented-out "temporarily waived" line sits next to it — NAVI to confirm which is in force (this affects reported revenue, not the adapter code).
- **Does the fee-to-TVL ratio make sense?** It should be a small fraction of the lending yield on the vaults' assets; reviewers can sanity-check against the TVL listing once both are live.
- **Related to an existing listing or open PR?** Yes: `fees/navi` (the lending market, unchanged by this PR) and the companion TVL PR in `DefiLlama/DefiLlama-Adapters`, which adds `projects/navi-prime` and `projects/navi-high-yield`.
- **Double counting:** the vaults' *assets* are double counted against the `navi` lending TVL and the TVL adapters are marked `doublecounted: true` accordingly. The *fees* are not: the gross yield here is the yield the vaults receive as lenders, which is `dailySupplySideRevenue` (a cost) on the `navi` lending listing, not revenue counted twice. Reviewers should confirm they agree with that reading.
- **Refill:** on first merge, a refill from `2026-08-17` is needed, and it can only run after NAVI's endpoint is backfilled to the same date.
- **Server-side wiring:** `dimensions: { fees: "navi-prime" }` and `dimensions: { fees: "navi-high-yield" }` in `defillama-server` is a follow-up after merge.

### The endpoint change NAVI must ship first

```jsonc
// GET /api/internal/defillama/fee?fromTimestamp=<unix seconds>
{
  "from": 1755388800, "to": 1755475200,
  /* …all existing lending fields unchanged… */
  "vaults": {                         // NEW, always present
    "prime":     { "grossYieldUSD": 0, "managementFeeUSD": 0, "performanceFeeUSD": 0 },
    "highYield": { "grossYieldUSD": 0, "managementFeeUSD": 0, "performanceFeeUSD": 0 }
  }
}
```

All three values are USD floats (not base units, not 1e18 wad), pre-aggregated per group over exactly `[from, to)`, and must be backfillable to 2026-08-17. A window that cannot be produced must return an error, never zeros.

---
_Generated by [Claude Code](https://claude.ai/code)_
