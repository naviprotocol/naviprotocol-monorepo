<!-- ccr-slack-attribution -->
_Requested by **Elliscope Fang** · [Slack thread](https://navi-protocol.slack.com/archives/C08AXCTBQL9/p1789127777481369)_

Adds one new TVL listing, `navi-vaults`, for NAVI's `navi_vault` product on Sui.

**Before:** DefiLlama listed NAVI's lending markets (the existing `navi` adapter) and nothing else. The four `navi_vault` objects in production — USDC Prime, SUI Prime, USDC High Yield, SUI High Yield — had no listing, so a user browsing DefiLlama could not see how much sits in the vault product.

**After:** a single `navi-vaults` listing covering all four vault objects. "Prime" and "High Yield" are NAVI's off-chain product labels over one Move contract — nothing on chain distinguishes them — so they are kept as code comments rather than split into separate listings.

**How:** the adapter reads each `Vault<CoinType>` object with `sui.getObjects` and adds that object's `total_assets` field (u64, base units) under the coin type taken from the object's own generic type argument. `total_assets` is the vault's idle balance plus everything it has supplied into NAVI's lending markets. The vaults have no borrow entrypoint, so nothing is netted out and there is no `borrowed` bucket.

Marked `doublecounted: true`: the vaults supply into NAVI's own already-listed `navi` lending markets, so those assets are inside that listing's TVL too and must not reach chain/category totals twice.

Only one file is added — `projects/navi-vaults/index.js`. No `package.json`, no lockfile, no new npm dependency, no change to any existing adapter.

---
## (Needs to be filled only for new listings)

##### Name (to be shown on DefiLlama):

NAVI Vaults (slug `navi-vaults`)

##### Twitter Link:

https://twitter.com/navi_protocol

##### List of audit links if any:

The vault contract is audited by Veridise and Certora; these are the report URLs NAVI's own app links to:

- Veridise: https://x4rjmmpwhoncvduw.public.blob.vercel-storage.com/uploads/2026-06-16/ktyailgyv4g40r76lq0c-TKYYxZ7ruvrb3X3vpSjhM6bkbxBDfk
- Certora: https://x4rjmmpwhoncvduw.public.blob.vercel-storage.com/uploads/2026-06-16/bodt8ztf6jex17e4be44-6x9sqrQ9XLMX03xp1EY7vLe2uyTuiu

The underlying lending protocol's audits (OtterSec, Veridise, MoveBit, Salus) are in NAVI's audits directory: https://github.com/naviprotocol/navi-smart-contracts/tree/main/audits

##### Website Link:

https://naviprotocol.io — the vaults themselves are at https://app.naviprotocol.io (Earn)

##### Logo (High resolution, will be shown with rounded borders):

https://app.naviprotocol.io/imgs/migrate/protocols/navi.svg

This is the NAVI mark NAVI's own production frontend serves and references for the protocol. It is a vector file, so it scales to any resolution. If you would rather these vaults reuse the artwork already attached to the existing `navi` listing, that is fine by us — please just say which you prefer.

##### Current TVL:

**Pending — not filled in, deliberately.** The environment this PR was prepared in has no egress to Sui RPC, `coins.llama.fi`, or NAVI's own API, so no on-chain read was possible and we will not quote a guessed number. Running `node test.js projects/navi-vaults/index.js` from a normal network produces the figure directly. We would rather hand you an empty field than an invented one; if you need the number before review, we can get it from a NAVI operator and post it as a comment.

##### Treasury Addresses (if the protocol has treasury)

None to declare for this listing. The vaults' curator/allocator address is `0x8f7607fa8c11b81b074c9fa95615742955f91035cd45ab6e4ac9dfd695fef606`, but that is an operational role key, not a treasury, so we are not claiming it as one.

##### Chain:

Sui

##### Coingecko ID (so your TVL can appear on Coingecko, leave empty if not listed): (https://api.coingecko.com/api/v3/coins/list)

##### Coinmarketcap ID (so your TVL can appear on Coinmarketcap, leave empty if not listed): (https://api.coinmarketcap.com/data-api/v3/map/all?listing_status=active,inactive,untracked&start=1&limit=10000)

##### Short Description (to be shown on DefiLlama):

Automated lending vaults on Sui that allocate deposits across NAVI's lending markets.

##### Token address and ticker if any:

##### Category (full list at https://defillama.com/categories) \*Please choose only one:

**Yield Aggregator** — this is our best reading rather than a confident answer. The vaults take a deposit and auto-allocate it across NAVI's lending markets with periodic rebalancing, which is the usual shape of that category. If your category list puts a lending-market-allocating vault somewhere else (`Yield`, for instance), please correct it to whatever you use — we will not argue with the maintainers' own taxonomy.

##### Oracle Provider(s): Specify the oracle(s) used (e.g., Chainlink, Band, API3, TWAP, etc.):

Pyth and Supra

##### Implementation Details: Briefly describe how the oracle is integrated into your project:

The vaults do not price anything themselves — they inherit the oracle setup of the NAVI lending markets they supply into. NAVI's production market configuration carries a Supra pair id alongside every Pyth feed id, so both feeds back each listed asset; a rebalance/harvest transaction refreshes the price feeds of the markets it touches before moving funds.

Worth noting for review: this TVL adapter needs no oracle at all. It reads a coin amount (`total_assets`) and adds it under a coin type, and DefiLlama prices the coin. Nothing in the adapter's output depends on an oracle being correct.

##### Documentation/Proof: Provide links to documentation or any other resources that verify the oracle's usage:

https://naviprotocol.gitbook.io/navi-protocol-docs — NAVI's public docs cover the lending protocol and its oracle usage, which is what the vaults inherit. The oracle feed ids themselves are in NAVI's on-chain market configuration and in the public SDK at https://github.com/naviprotocol/naviprotocol-monorepo.

##### forkedFrom (Does your project originate from another project):

Not a fork. `navi_vault` is NAVI's own Move contract.

##### methodology (what is being counted as tvl, how is tvl being calculated):

Sums the `total_assets` field of NAVI's four `navi_vault` objects on Sui (USDC and SUI, across NAVI's Prime and High Yield product lines), read directly from each vault object on chain. `total_assets` is a vault's idle balance plus the assets it has supplied into NAVI's lending markets, as of that vault's last market sync — it is a stored balance the contract refreshes when a market balance is synced (every deposit and withdraw does), so lending interest accrued since that sync is not yet included. The vaults do not borrow, so nothing is netted out.

Marked as double counted because the supplied assets are also part of the NAVI lending market TVL reported by the existing `navi` listing. The overlap is not exact — `projects/navi/index.js` reports each market's `total_supply - borrowed`, so the borrowed slice of the vaults' assets is not in that listing, and `idle_balance` sits in the vault object rather than in a market — but the flag is all-or-nothing, and flagging the whole book under-reports rather than over-reports.

##### Github org/user (Optional, if your code is open source, we can track activity):

https://github.com/naviprotocol

##### Does this project have a referral program?

No.

---

### Two questions for maintainers

1. **`parentProtocol` grouping.** We would like `navi-vaults` to appear under the existing `navi` protocol rather than as an unrelated top-level entry — the vaults are the same team and the same deployment, and grouping them is what makes the `doublecounted` flag legible to a user. As far as we can tell that grouping is not something an adapter PR can declare, so we are asking rather than asserting it: is that a change you make on your side, or should it go to metadata@defillama.com?

2. **Category**, as above — please overwrite `Yield Aggregator` if your list says otherwise.

### Notes for reviewers

- **The adapter has not been validated against live chain data.** `node test.js projects/navi-vaults/index.js` reaches `sui.getObjects` and then fails at the network layer (`Failed to post https://graphql.mainnet.sui.io/graphql`) because the environment this was prepared in has no Sui RPC egress. `node --check` and `npx eslint projects/navi-vaults/index.js` are both clean. Please re-run the adapter, or ask us to, before merging — we are not representing an untested run as a passing one.
- The vault object ids are listed explicitly rather than enumerated by type. The reasoning is in a comment in the file: the author could not reach NAVI's public vault endpoint to verify what it returns, and preferred an explicit id list read on chain over parsing an unverified response. The tradeoff is a stale-list risk — a vault launched later is missing until an id is added — and https://open-api.naviprotocol.io/api/vaults is the maintained source to diff the list against.
- "Allow edits by maintainers" is enabled.
- The matching fees/revenue adapter belongs in `DefiLlama/dimension-adapters` and is **not** part of this PR; it is still blocked on a NAVI backend change.

---
_Generated by [Claude Code](https://claude.ai/code)_
