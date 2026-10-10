---
'@naviprotocol/astros-bridge-sdk': minor
---

Add opt-in `preswapRouting: 'mayan'` for Sui-source bridges. The Sui pre-swap is requested without the referrer while the order keeps it, and the transaction is simulated before signing and rebuilt from the same quote when the pre-swap misses the order minimum. Quote minimums are unchanged; exhausted retries throw `BRIDGE_QUOTE_EXPIRED`.
