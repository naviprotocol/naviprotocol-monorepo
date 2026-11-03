---
'@naviprotocol/multiply': minor
---

Use fixed numeric strategy/version keys in MultiplyRegistry for AccountCap discovery
and atomic registration. Replace name-based identities with registryKey, require
matching sender/deployment/strategy bindings, and upgrade execution plans to v3.
Unregistered legacy Caps are intentionally excluded. Custom data sources must
declare their Registry deployment and return numeric strategy bindings.
