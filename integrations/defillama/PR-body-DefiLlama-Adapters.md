<!-- ccr-slack-attribution -->
_Requested by **Elliscope Fang** · [Slack thread](https://navi-protocol.slack.com/archives/C08AXCTBQL9/p1789127777481369)_

Adds two new TVL listings for NAVI's `navi_vault` product on Sui: **NAVI Prime** and **NAVI High Yield**.

**Before:** DefiLlama listed NAVI's lending markets (the `navi` adapter) and nothing else. The four `navi_vault` vaults NAVI launched on 2026-08-17 — USDC Prime, SUI Prime, USDC High Yield, SUI High Yield — had no listing of their own, so a user browsing DefiLlama could not see how much is deposited in the vault product or compare the Prime and High Yield strategies against other Sui yield venues.

**After:** two listings, `navi-prime` (USDC Prime + SUI Prime) and `navi-high-yield` (USDC High Yield + SUI High Yield), each reporting its vaults' assets. The split mirrors NAVI's own Earn page, which has separate Prime and High Yield tabs. Both are marked `doublecounted: true` — the vaults deposit their assets into NAVI's own lending markets, so those assets are already inside the `navi` listing's TVL and must not be added to DefiLlama's chain and category totals twice.

**How:** each adapter reads its two `Vault<CoinType>` objects with `sui.getObjects` and adds the object's `total_assets` field (u64, base units) under the coin type taken from the object's own generic type argument. `total_assets` is the vault's idle balance plus everything it has supplied into the lending markets. The vaults have no borrow entrypoint, so there is nothing to net out and no `borrowed` bucket. The vault object ids are hardcoded on purpose rather than enumerated by type: NAVI runs a second `navi_vault` package on the same mainnet as a staging rehearsal deployment, with identical struct types, and a type enumeration would pull those non-production vaults into TVL.

---
## (Needs to be filled only for new listings)

This PR adds **two** listings; where the answers differ they are given per listing.

##### Name (to be shown on DefiLlama):

`NAVI Prime` (slug `navi-prime`) and `NAVI High Yield` (slug `navi-high-yield`).

##### Twitter Link:

https://twitter.com/navi_protocol

##### List of audit links if any:

- NAVI lending protocol audits (OtterSec, Veridise, MoveBit, Salus): https://github.com/naviprotocol/navi-smart-contracts/tree/main/audits
- The vault contract itself is audited by Veridise and Certora; the reports NAVI's app links to are `TODO — NAVI to confirm` canonical public URLs for these two vault reports (they are currently served from a Vercel blob host rather than the audits repo).

##### Website Link:

https://naviprotocol.io — vaults at https://app.naviprotocol.io (Earn)

##### Logo (High resolution, will be shown with rounded borders):

`TODO — NAVI to confirm` (a high-resolution logo for each of the two new listings; the existing `navi` logo may or may not be what NAVI wants reused).

##### Current TVL:

`TODO — NAVI to confirm`. No on-chain read was possible while preparing this PR (no Sui RPC egress from the authoring environment), so no TVL figure is quoted here rather than a guessed one.

##### Treasury Addresses (if the protocol has treasury)

`TODO — NAVI to confirm`. The vaults' curator and allocator address is `0x8f7607fa8c11b81b074c9fa95615742955f91035cd45ab6e4ac9dfd695fef606`, but whether that is a treasury in DefiLlama's sense — and where the accrued management/performance fee shares are ultimately claimed to — is for NAVI to state.

##### Chain:

Sui

##### Coingecko ID (so your TVL can appear on Coingecko, leave empty if not listed):

`TODO — NAVI to confirm`. The vault products are not separately listed on CoinGecko; NAVI's own token is NAVX. The vault share positions are not tradable tokens.

##### Coinmarketcap ID (so your TVL can appear on Coinmarketcap, leave empty if not listed):

`TODO — NAVI to confirm` (same reasoning as above).

##### Short Description (to be shown on DefiLlama):

- NAVI Prime: "Automated lending vaults on Sui that allocate deposits across NAVI's blue-chip collateral markets."
- NAVI High Yield: "Automated lending vaults on Sui that allocate deposits across NAVI's lending markets for higher yield."

##### Token address and ticker if any:

NAVX — `0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX`. It is NAVI's protocol token, not a vault share token; the vaults themselves issue no transferable token.

##### Category (full list at https://defillama.com/categories) \*Please choose only one:

Yield

##### Oracle Provider(s): Specify the oracle(s) used (e.g., Chainlink, Band, API3, TWAP, etc.):

Pyth (inherited from the NAVI lending markets the vaults supply into).

##### Implementation Details: Briefly describe how the oracle is integrated into your project:

The vaults do not price anything themselves. Each rebalance/harvest transaction refreshes the Pyth price feeds of the markets it touches before moving funds, and the markets' own price oracle objects are what value collateral. The TVL adapter needs no oracle at all: it reads a coin amount (`total_assets`) and DefiLlama prices the coin.

##### Documentation/Proof: Provide links to documentation or any other resources that verify the oracle's usage:

https://naviprotocol.gitbook.io/navi-protocol-docs — `TODO — NAVI to confirm` a direct docs link for the vault product and its oracle usage; the current public docs cover the lending protocol.

##### forkedFrom (Does your project originate from another project):

Not a fork. `navi_vault` is NAVI's own Move contract.

##### methodology (what is being counted as tvl, how is tvl being calculated):

For each listing, the `total_assets` field of its two `Vault<CoinType>` objects is read on chain and added under the vault's coin type. `total_assets` is the vault's idle balance plus the assets it has supplied into NAVI's lending markets. Nothing is borrowed by the vaults, so nothing is subtracted. Both listings are `doublecounted: true` because those supplied assets are already counted by the `navi` lending listing.

##### Github org/user (Optional, if your code is open source, we can track activity):

https://github.com/naviprotocol

##### Does this project have a referral program?

`TODO — NAVI to confirm`

---

### Notes for reviewers

- `node test.js projects/navi-prime/index.js` and `node test.js projects/navi-high-yield/index.js` were run and both reach `sui.getObjects` and then fail at the network layer (`Failed to post https://graphql.mainnet.sui.io/graphql`) because the authoring environment has no egress to Sui RPC. `node --check` and `eslint` are clean on both files. **The adapters have not been validated against live chain data** — please re-run them, or ask NAVI to, before merging.
- The matching fees/revenue adapters are a separate PR in `DefiLlama/dimension-adapters` and are **blocked** on a NAVI backend change; they should not be merged first.
- No `package.json`, lockfile, or existing-adapter changes are included.

---
_Generated by [Claude Code](https://claude.ai/code)_
