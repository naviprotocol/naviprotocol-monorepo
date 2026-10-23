---
'@naviprotocol/astros-bridge-sdk': minor
---

Support Mayan Fast MCTP (Circle CCTP v2) bridges from Sui. Mayan swap-sdk is bumped to 15.3.0, which builds Sui-source Fast MCTP orders; the Sui pre-swap input preparation and `preswapRouting: 'mayan'` (pre-swap requested without the referrer, simulated before signing and rebuilt from the same quote on a missed minimum or a malformed pre-swap) now cover Fast MCTP as well as MCTP. Bridge quote requests declare `BRIDGE_QUOTE_CAPABILITIES` (`fastMctp=1`, also exported for clients that call `/bridge-swap/find_routes` themselves), so the bridge API only offers Sui Fast MCTP routes to clients that can build them.
