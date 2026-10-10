---
'@naviprotocol/astros-bridge-sdk': minor
---

Add opt-in `preswapRouting: 'mayan'` for Sui-source auction bridges. The Sui pre-swap is requested without the referrer while the order keeps it, and the transaction is simulated before signing and rebuilt from the same quote when the pre-swap misses the order minimum or comes back malformed. Quote minimums are unchanged; a missed minimum after retries, or a passed quote deadline, throws `BRIDGE_QUOTE_EXPIRED`.
