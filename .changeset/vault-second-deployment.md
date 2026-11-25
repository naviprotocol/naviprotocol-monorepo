---
'@naviprotocol/vault': minor
---

Support a second `navi_vault` deployment. `Vault.navi` accepts optional `originalPackage` (receipt struct type prefix) and `lendingEnv` (`'prod' | 'dev'`, forwarded to every `@naviprotocol/lending` call). Omitting both keeps the production behaviour unchanged.
