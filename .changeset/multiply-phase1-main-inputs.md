---
"@naviprotocol/multiply": minor
---

Support principal equal to collateral or debt, explicit accepted opening inputs,
and execution plan v4 with independently checked funding and conversion roles.
Preserve collateral-principal exits and separate debt dust; reject legacy plans.
Add explicit retired Registry keys, classified minimum-amount fallback, route/fee
metadata and an optional consistent-position source contract. Pin Lending 2.2.0.
The default source does not claim checkpoint-consistent lifetime yield.

Bound collateral-principal debt clearing to executable collateral amounts. Keep
empty or sub-atom conversion results separate from malformed upstream responses,
and reject invalid native pool state before allowing DEX fallback.
