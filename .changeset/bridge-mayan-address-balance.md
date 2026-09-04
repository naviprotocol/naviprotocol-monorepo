---
'@naviprotocol/astros-bridge-sdk': patch
---

fix(bridge): bump @mayanfinance/swap-sdk 15.0.0 → 15.2.2 to fix Sui
address-balance coin selection

Mayan swap-sdk 15.0.0 gathered Sui source coins via `core.listCoins`
only, so funds held in the Sui V2 address-balance accumulator
(`getBalance().addressBalance`) were invisible to coin selection. When a
bridge amount exceeded the sum of plain `Coin<T>` objects, the build
threw a misleading `Insufficient funds to create Coin <type> with amount
<X>` even though the wallet held far more — small amounts passed, large
amounts failed (reproduced on Sui→Solana USDC bridge). Mayan 15.2.2
backfills the accumulator (`getBalance().addressBalance` +
`0x2::coin::redeem_funds`), matching the fix already applied to the
aggregator/dca/lending coin selection.
