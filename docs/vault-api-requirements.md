# Vault API requirements for `@naviprotocol/vault`

What `navi-vault-api` and `vault-api.volosui.com` need to return so that
`vaults.getVault()` yields something the PTB builders can use directly.

Section 1 is the whole ask for NAVI. Volo additionally needs a rewards endpoint (§3) before
reward claiming can work there. Everything else was considered and dropped — the SDK either
already has the data or can do the work itself.

Per the SDK design the backend returns the unified `Vault` shape and the SDK only fetches
and caches it. Everything below already exists in both backends' static config — NAVI in
`src/protocols/navi/config/prod.ts` (`VaultStaticConfig`), Volo in
`sdk/setup/address.production.ts` and `src/config/vault.config.ts`. This is a
serialization request, not new data.

Fields that only mean something inside the SDK are **not** requested — see
[the last section](#fields-the-sdk-fills-in-itself).

## 1. `GET /vaults` and `GET /vaults/:id` — add `assets` and `contractConfig`

Add them as new top-level keys alongside the existing display fields, so current consumers
are unaffected.

### NAVI

```json
{
  "id": "0x864527a8...",
  "assets": { "base": { "coinType": "0x2::sui::SUI" } },
  "contractConfig": {
    "package": "0x13e1e0dd...",
    "naviLending": {
      "markets": [
        {
          "code": "main",
          "isDefault": true,
          "poolObjectId": "0x96df0fce...",
          "storageObjectId": "0xbb4e2f4b...",
          "incentiveV2ObjectId": "0xf87a8acb...",
          "incentiveV3ObjectId": "0x62982dad..."
        }
      ],
      "rewardRules": [
        {
          "ruleIndex": 0,
          "type": "market",
          "active": true,
          "rewardCoinType": "0x549e8b69...::cert::CERT",
          "naviPoolId": "0x96df0fce...",
          "rewardFundObjectId": "0x7093cf75..."
        }
      ]
    }
  }
}
```

Mapping from `VaultStaticConfig`, one to one except where noted:

| SDK field                                             | backend field                               | note                                                                                         |
| ----------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `assets.base.coinType`                                | `coinType`                                  | already on the response                                                                      |
| `contractConfig.package`                              | `currentPackageId`                          | the upgrade target, **not** `initPackageId`                                                  |
| `markets[].code` / `poolObjectId` / `storageObjectId` | `code` / `poolAddress` / `storageAddress`   | `code` uses the `/api/navi/markets` key — `main`, `sui-eco`, `vsui-sui`                      |
| `markets[].incentiveV2ObjectId` / `V3`                | `incentiveV2Address` / `incentiveV3Address` | only the default market's are read, but the shape stays uniform                              |
| `markets[].isDefault`                                 | `isDefault`                                 | exactly one market carries it                                                                |
| `rewardRules[].active`                                | `isActive`                                  |                                                                                              |
| `rewardRules[].type`                                  | `type`                                      | **`vault-native`, not `vault_native`** — hyphen                                              |
| `rewardRules[].ruleIndex`                             | `ruleIndex`                                 | the contract addresses rules by index, so send it even if the array is complete and in order |
| `rewardRules[].naviPoolId`                            | `naviPoolId`                                | required for active `market` rules; also the key into `markets`                              |
| `rewardRules[].rewardFundObjectId`                    | `rewardFundId`                              | required for active `market` rules                                                           |

Not requested on a rule: `storageAddress` and `incentiveV3Address`. `collect_reward` calls
`assert_storage_and_incentive_v3_match_market(navi_pool_id, ...)`, so they can only ever be
those of the market `naviPoolId` names — the SDK joins them out of `markets`, and a second
copy on the rule would only add a way for the two to disagree.

`rewardFundObjectId`, on the other hand, cannot be derived. It is per market, not per
reward coin: `CERT` resolves to `0x7093cf75…` on `main` but `0xd29c6e01…` on `sui-eco`.

`markets` must list **every** registered market, disabled ones included: the contract
asserts all of them were synchronized in the same transaction as a deposit or withdrawal,
so an incomplete list aborts `E_MARKET_NOT_READ` (10006). Same for active `market` reward
rules and `E_REWARDS_NOT_COLLECTED` (10007). A vault that gains a market has to be
reflected here, or every deposit and withdrawal on it starts failing.

Two of these values change over the vault's life, and while the response is stale
**everything fails**, so they need updating in the same window as the on-chain change:

|                       | changes when                                            | stale symptom                                                                                                           |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `package`             | the contract is upgraded and vault objects are migrated | abort 10036 / `ERR_INVALID_VERSION` — the version check is strict equality against a constant compiled into the package |
| `markets[].isDefault` | governance moves the default market                     | abort `E_DEFAULT_MARKET_MISMATCH` (10022) on deposit, and on any withdrawal larger than the vault's idle balance        |

The 10022 case is loud rather than expensive — the contract asserts the pool it is handed
is the current default, so a stale default cannot quietly route a withdrawal through a
penalised market. Note the asymmetry though: a withdrawal small enough to be covered by
`idle_balance` never validates the pool at all, so a stale default shows up as "small
withdrawals work, large ones fail".

Not needed: `initPackageId`, `timelockId`, `markets[].assetId`,
`rewardRules[].incentiveRuleId`, `priceOracleId`, and any oracle package or config id.
`PriceOracle` is a lending-wide object, identical across markets, already published by
`@naviprotocol/lending`'s config service — which this SDK reads anyway to resolve the
oracle entrypoint. `SuiSystemState` (`0x5`) and the `Clock` (`0x6`) are genesis objects and
are constants in the SDK.

### Volo

```json
{
  "id": "0x6e53ffe5...",
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

| SDK field                    | backend source                                               | note                                                                                                 |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `assets.base.coinType`       | `VaultConfig.coinType`                                       |                                                                                                      |
| `contractConfig.package`     | `ADDRESSES_PRODUCTION.package_id` (**not** `package_id_old`) |                                                                                                      |
| `volo.receiptParentObjectId` | per-vault `receiptsId`                                       | optional — only read to choose between several receipts                                              |
| `volo.rewardManagerObjectId` | per-vault `rewardManager`                                    | required: `user_entry::deposit` takes it as its second argument, so it is not only a rewards concern |

`coinType` is the blocking one: the Volo `/vaults` response carries no coin type today, and
without it there is no type argument for any `moveCall` and no way to tell which coin to
spend from the caller's wallet.

`decimals` is deliberately **not** requested. The PTB builders take amounts in the coin's
smallest unit, matching `@naviprotocol/lending`, so nothing in the SDK converts.

Not needed: `vaultCode`, `configObjectId`, `stakingObjectId`, `metadataObjectId`.

## 2. `GET /users/:address/position` — nothing required

The SDK finds a holder's receipts on chain — `listOwnedObjects` filtered by the receipt
type, matched on each object's vault field — and reads balances there too: `get_user_balance`
in one simulated block for NAVI, the `receipts` Table entry for Volo. Both are already
implemented, and the Volo read returns the exact `u256`, which matters for a full exit
because `user_entry::withdraw` is denominated in shares.

A per-receipt breakdown on the response would save those reads:

```json
{ "receipts": [{ "receiptId": "0x37841fde...", "shares": "69027630406" }] }
```

Worth having eventually, not worth blocking on. If it is added, `shares` needs to be a
string: Volo shares are `u256`, and a JSON number loses precision past
`Number.MAX_SAFE_INTEGER` (`9007199254740992`). That threshold is per holder, not per
vault, and works out to a single position of roughly $6M on xBTC — the vault most likely to
reach it — so it is a correctness cliff rather than a present-day bug.

## 3. Rewards — Volo needs an endpoint, NAVI needs nothing

**NAVI: no change.** `claim_reward` takes only `(vault, receipt, clock)` — no amount — and
returns a zero coin instead of aborting when a receipt has nothing:

```move
if (!self.user_states.contains(receipt_id)) { return coin::zero<RewardCoinType>(ctx) };
if (!self.collected_rewards.contains(reward_coin_type_str)) { return coin::zero(ctx) };
if (bag_value == 0) return coin::zero(ctx);
```

So the SDK can pair the reward coin types it already has from
`contractConfig.naviLending.rewardRules[].rewardCoinType` with the holder's receipts read
on chain. The existing `/users/:address/claimable?vaultId=…` stays a display endpoint.

**Volo: an endpoint is needed.** Its `claim_reward` aborts in two cases the SDK cannot see
without asking:

```move
assert!(vault_receipt.status() == NORMAL_STATUS, ERR_WRONG_RECEIPT_STATUS);
...reward_balances.borrow_mut<TypeName, Balance<RewardCoinType>>(reward_type)  // unregistered type aborts
```

so a blind cross-product of receipts and coin types would fail. What is needed is which
reward coin types are claimable for a given receipt. Mirroring NAVI's
`/users/:address/claimable?vaultId=` would let both protocols share one code path;
`claimable` amounts are display-only either way.

Until that exists, Volo reward claiming stays unavailable through `sdk.user` — the
alternative is reading the receipt's `unclaimed_rewards` Table on chain, which is another
dynamic-field layer.

## 4. Pending requests — nothing to add

Volo `GET /users/:address/requests` already returns `requestId` and `receiptId` on every
entry, which is exactly what `cancelDepositPTB` / `cancelWithdrawPTB` take.

NAVI settles instantly and has no pending state, so the SDK returns an empty list there.

## 5. Response envelopes — nothing to change

`GET /vaults` is `{data: [...]}` on NAVI and `{total, data, page, limit, totalPages}` on
Volo; `GET /users/:address/position` is `{data: [...]}` on NAVI but a bare array on Volo.
The SDK normalises this itself rather than asking two services to agree.

## <a id="fields-the-sdk-fills-in-itself"></a>Fields the SDK fills in itself

These exist on the SDK's `Vault` type but are not requested from the backend: they are
either SDK-internal routing concepts or constants.

| Field                                      | How the SDK sets it                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app` (`navi` / `volo` / `astros`)         | From which request produced the row: navi-vault-api `/vaults` and volosui `/vaults?protocol=navi` are `navi`, `?protocol=volo` is `volo`, `?protocol=astros` is `astros`. The `?protocol=` filter already works.             |
| `protocol` (`navi-lending` / `volo-vault`) | From the endpoint: navi-vault-api is `navi-lending`, volosui is `volo-vault`                                                                                                                                                 |
| `operatorMode`                             | Follows `protocol` — `navi-lending` is `instant`, `volo-vault` is `eventual`                                                                                                                                                 |
| `contractConfig.env`                       | Removed. `env` belongs to the SDK instance, passed to `createVaultSdk` — one instance serves one environment, since `test` is a separate stage deployment behind its own API rather than a mix of vaults inside one instance |

**Name collision, worth being explicit about.** Both backends already have a `protocol`
field taking the values `navi | volo | astros`. That is the SDK's **`app`**, not the SDK's
`protocol` (`navi-lending | volo-vault`). Mapping the two by name is wrong, which is part of
why the SDK derives both itself rather than reading either from the response.

`app` and `protocol` are genuinely independent, not two names for one thing:
`SUI LST NAVI SINGLE LOOP` (`0x4b7349d6…`) is NAVI-branded but runs on the Volo contract —
its on-chain type is `0xcd86f775…::vault::Vault<0x2::sui::SUI>`.
