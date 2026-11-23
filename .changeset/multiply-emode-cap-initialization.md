---
"@naviprotocol/multiply": minor
---

Support strategy-configured E-Mode risk parameters and enter the configured mode
when creating an AccountCap, without registering in the independent E-Mode Registry.
Validate market, asset roles and mode activity, including paused-mode reads and
risk-reducing operations. Existing Caps are not migrated or re-entered.

Expose object-version evidence for cached position reads and a simulation-oriented
builder that preserves funding and final risk constraints. Handle six-decimal
collateral dust exits without a nonexistent principal output, and retain repayment
for positions with non-positive equity.
