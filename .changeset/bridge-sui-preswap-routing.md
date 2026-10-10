---
'@naviprotocol/astros-bridge-sdk': minor
---

Add opt-in `preswapRouting: 'mayan'` for Sui-source bridges. The Sui pre-swap is requested without the referrer while the bridge calls are unchanged (auction orders keep the referrer and its fee), and the transaction is simulated before signing and rebuilt from the same quote when the pre-swap misses the order minimum or comes back malformed. Quote minimums are unchanged; a missed minimum after retries, or a passed quote deadline, throws `BRIDGE_QUOTE_EXPIRED`.
