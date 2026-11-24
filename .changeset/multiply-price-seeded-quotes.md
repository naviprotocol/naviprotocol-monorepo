---
'@naviprotocol/multiply': patch
---

Calculate native Volo/Haedal stake conversions locally from coherent integer chain
snapshots, avoiding formal quotes when the price/fee-seeded funding plan meets the
existing tolerance and oracle risk checks. Preserve original solver fallback and
execution guards. Add epoch-aware bounded caching, exact fee/rounding handling,
minimum-amount regressions and complete read-only mainnet build simulations.
Correct Haedal staking fee estimation to match its pinned entrypoint, which does
not charge the stored deposit_fee; redemption remains unchanged.
