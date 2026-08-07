---
'@naviprotocol/vault': minor
'@naviprotocol/lending': patch
---

Add `@naviprotocol/vault`, an SDK for NAVI's single-asset yield vaults.

Covers layout discovery, receipt attribution, simulation-based pricing and previews, and
transaction builders for deposit, withdrawal, full exit and reward claims. Deposits and
withdrawals emit the freshness prologue the contract requires — one `sync_market_balance`
per registered market and one `collect_reward` per active market rule — and withdrawals
additionally emit the oracle price update, delegated to `@naviprotocol/lending` so that
oracle entrypoint revisions are picked up from configuration rather than an SDK release.

Also exports `parseVaultError`, which classifies aborts across the three packages a vault
transaction can fail in, so that `lending_core` 1400/1506 and oracle 1502 are not reported
as user error.

Read paths are verified against all four mainnet vaults. Transaction builders are
verified by simulating the deposit, full-exit and claim blocks through the Move VM
against live state, covering both the no-rule and harvest-required shapes; deposit and
full exit were additionally executed on mainnet against SUI Prime.

lending: export `devInspectTransaction`, previously internal, so dependent packages can
simulate read-only blocks through the same v2 Core transport.
