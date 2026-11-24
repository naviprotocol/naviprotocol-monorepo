---
'@naviprotocol/multiply': patch
---

Make a target equal to `maxLeverage` reachable by enforcing the ceiling with the
solver's 0.01% tolerance at quote, live rebuild and on chain, and never refuse
`close`, `repay` or `add_collateral` by it: a position above `maxLeverage` stays
exitable, and other decreases may keep but not raise its leverage. Allow `add_collateral`
without positive equity, convert only what a debt-principal deleverage to 1x needs,
lever a small `add_principal` that keeps the current leverage, and report a
`remove_principal` target that needs new debt as `ACTION_UNSUPPORTED`. Bind a
supplied `inputs.accountCap` argument on chain to the quoted lending account; a
custom data source must mark a Cap created inside the same PTB `transient: true`
to supply it unbound.
