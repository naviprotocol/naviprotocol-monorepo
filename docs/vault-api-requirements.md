# Vault API fields `@naviprotocol/vault` needs

The SDK reads vaults and positions from NAVI's open API — `GET /api/vaults`,
`GET /api/vaults/:id`, `GET /api/vaults/positions` — which aggregates both vault backends
behind one shape. Requests here are therefore against the aggregator
(`navi-open-api`, `src/services/vaults/`), which in turn needs them from whichever upstream
holds the value.

Two things to add — the vault config in §1 and the reward breakdown in §2. §3 is a list of
fields that must not be renamed.

Everything in §1 already exists in both backends' static config — NAVI in
`src/protocols/navi/config/prod.ts` (`VaultStaticConfig`), Volo in
`sdk/setup/address.production.ts` and `src/config/vault.config.ts`. This is a serialization
request, not new data.

**§1 is what blocks the SDK today.** `StandardVault` is deliberately the intersection of
what both upstreams serve, and neither serves contract wiring, so `assets` and
`contractConfig` have to be added as a documented exception to that rule. Until they are,
`vaults.getVaults()` returns an empty list and `vaults.getVault()` returns `null` — the
SDK reads both fields when present and needs no change once they land.

---

## 1. `GET /api/vaults` and `GET /api/vaults/:id` — add `assets` and `contractConfig`

New top-level keys on each vault, alongside the existing response, so current consumers are
unaffected.

### NAVI

```json
{
  "assets": { "base": { "coinType": "0x2::sui::SUI" } },
  "contractConfig": {
    "package": "0x13e1e0dd...",
    "naviLending": {
      "markets": [
        { "code": "main", "isDefault": true },
        { "code": "sui-eco", "isDefault": false }
      ],
      "rewardRules": [
        {
          "ruleIndex": 0,
          "type": "market",
          "active": true,
          "rewardCoinType": "0x549e8b69...::cert::CERT",
          "naviPoolId": "0x96df0fce..."
        }
      ]
    }
  }
}
```

| Field needed                   | Taken from `VaultStaticConfig`                                      |
| ------------------------------ | ------------------------------------------------------------------- |
| `assets.base.coinType`         | `coinType` (already on the response)                                |
| `contractConfig.package`       | `currentPackageId`                                                  |
| `markets[].code`               | `code` — the `/api/navi/markets` key: `main`, `sui-eco`, `vsui-sui` |
| `markets[].isDefault`          | `isDefault` — exactly one market carries it                         |
| `rewardRules[].ruleIndex`      | `ruleIndex`                                                         |
| `rewardRules[].type`           | `type` — `market` or `vault-native`                                 |
| `rewardRules[].active`         | `isActive`                                                          |
| `rewardRules[].naviPoolId`     | `naviPoolId` — required for active `market` rules                   |
| `rewardRules[].rewardCoinType` | `rewardCoinType`                                                    |

**Not needed**: `markets[].poolAddress` / `storageAddress` / `incentiveV2Address` /
`incentiveV3Address`, `rewardRules[].rewardFundId` / `storageAddress` /
`incentiveV3Address`, `priceOracleId`, `initPackageId`, `timelockId`,
`markets[].assetId`, `rewardRules[].incentiveRuleId`.

The SDK resolves those lending-side objects through `@naviprotocol/lending` by
`markets[].code` — `getConfig({market})` and `getPool()` — so `code` and `naviPoolId` are
enough.

### Volo

```json
{
  "assets": { "base": { "coinType": "0xaafb102d...::btc::BTC" } },
  "contractConfig": {
    "package": "0xfba9e787...",
    "volo": {
      "receiptParentObjectId": "0x72da674c...",
      "rewardManagerObjectId": "0xf5c28be9..."
    }
  }
}
```

| Field needed                 | Taken from                                             |
| ---------------------------- | ------------------------------------------------------ |
| `assets.base.coinType`       | `VaultConfig.coinType` (**not returned at all today**) |
| `contractConfig.package`     | `ADDRESSES_PRODUCTION.package_id`                      |
| `volo.receiptParentObjectId` | each vault's `receiptsId`                              |
| `volo.rewardManagerObjectId` | each vault's `rewardManager`                           |

Not needed: `vaultCode`, `configObjectId`, `stakingObjectId`, `metadataObjectId`,
`coinDecimals`.

### Three ways to get this wrong silently

**1. `package` must be `currentPackageId`, never `initPackageId` / `package_id_old`.**
The wrong one does not error — it runs the pre-upgrade contract.

**2. `rewardRules[].type` is hyphenated `vault-native`, not `vault_native`.** A mismatch
does not error — the SDK treats a rule that must be harvested as one that need not be, and
the transaction aborts later.

**3. `markets` must list every registered market, disabled ones included, and `rewardRules`
must be complete.** A missing market aborts `E_MARKET_NOT_READ` (10006) and a missing active
`market` reward rule aborts `E_REWARDS_NOT_COLLECTED` (10007). **`ruleIndex` is the position
in the contract's rule vector, so no rule may be filtered out — filtering shifts the
indices.**

### Two fields that must be updated in step with on-chain changes

| Field                 | Changes when                                        | If it lags                                                                                                                                                       |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package`             | the contract is upgraded and vault objects migrated | everything aborts 10036 — the version check is strict equality                                                                                                   |
| `markets[].isDefault` | governance moves the default market                 | every deposit aborts 10022; a withdrawal aborts 10022 only once it exceeds the vault's idle balance, so it presents as "small withdrawals work, large ones fail" |

---

## 2. Rewards — `receiptId` on NAVI, a new endpoint on Volo

Neither is aggregated yet; `user.getRewards` is unimplemented until they are.

Rewards accrue per receipt and are claimed per receipt, so the receipt dimension is needed.

### NAVI: add `perReceipt` to `GET /users/:address/claimable?vaultId=…`

Today it aggregates per reward coin, with no receipt breakdown. Needed:

```json
{
  "rewards": [
    {
      "rewardCoinType": "0x549e8b69...::cert::CERT",
      "perReceipt": [{ "receiptId": "0x107f1a0c...", "claimable": "5701103" }]
    }
  ]
}
```

`receiptId` is the required part. `claimable` is display-only and only has to be right
enough to show.

### Volo: an endpoint of the same shape

None exists. What is needed is which reward coin types a given receipt can currently claim.

It cannot be guessed: Volo's `claim_reward` aborts on a reward coin the vault has not
registered, and on a receipt whose status is not `NORMAL`.

---

## 3. Fields the SDK already reads — do not rename or drop

These back the SDK's public types. A rename does not error; the SDK reads 0 or undefined and
every consumer silently gets wrong data.

**`GET /api/vaults/positions`**: `vaultId`, `address`, `source`, `protocol`, `shares`,
`tokenBalance`, `tokenUsd`, `coinPrice`, `apr`, `yieldLifetimeAmount`, `yieldLifetimeUsd`

Two invariants on that endpoint matter as much as the names. `shares` must stay a decimal
integer **string** — Volo's share counts run past `Number.MAX_SAFE_INTEGER`, so serializing
it as a JSON number loses precision silently. And `apr` must stay a decimal fraction:
`null` for an implausible value is correct and the SDK passes it through, but a value on
the percent scale would be reported as a yield a hundred times too high.

`source` and `protocol` are not interchangeable: `source` says which upstream served the
row, `protocol` says which app the vault is branded as, and a NAVI-branded vault can be
served by the Volo upstream. The SDK exposes them as `source` and `app` respectively, so
collapsing them would mislabel exactly those vaults.

**`GET /api/vaults`**: `id`, `source`, `protocol`, and the display fields the SDK carries
through as `Vault.stats` — `name`, `riskLevel`, `status`, `apy` (`avg7d` / `avg30d` /
`instant` / `target`), `totalStaked`, `totalStakedUsd`, `totalShares` (a **string**, same
reason as `shares`), `exchangeRate`, `coinPrice`, `minInvestment`, `stakeCapAmount`,
`lockup`

**`GET /api/vaults/:id`**: a missing vault must stay a **404**, which is how the SDK tells
"no such vault" apart from a failed request

**`GET /users/:address/requests`, Volo's own API**: the `deposits` and `withdrawals`
arrays, and on each entry `requestId`, `receiptId`, `vaultId`, `executeTime`, plus `amount`
on a deposit and `shares` on a withdrawal. This one is still read directly from Volo — it
has no counterpart on the aggregator.
