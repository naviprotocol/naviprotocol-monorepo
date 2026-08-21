# @naviprotocol/vault

TypeScript SDK for NAVI Lending Vaults and Volo Vaults on Sui.

## Layers

`sdk.user` covers the common paths — deposit, withdraw, claim — with one shape across both
protocols. It resolves a `VaultIdentifier`, dispatches on `vault.protocol`, and throws
`OPERATION_NOT_SUPPORTED` for operations a protocol does not have.

`protocols/*` sits underneath and wraps the contract entrypoints directly. Anything the
common path deliberately omits — a slippage bound, a non-default withdrawal market — is
composed here.

## Vault model

`Vault` is discriminated on `protocol`, so narrowing it also narrows `contractConfig`:

```ts
if (vault.protocol === 'navi-lending') {
  vault.contractConfig.naviLending.markets // no cast needed
}
```

`app` identifies the product surface, `protocol` selects the contract implementation, and
`operatorMode` says how a request settles: `instant` mints or redeems inside the caller's
own transaction, `eventual` records a request an operator fulfils later, which is why
cancellation exists on one protocol and not the other.

`contractConfig` carries only what varies per vault. The two package identities each
protocol was published under, and the `Clock`, are fixed for the lifetime of a deployment
and live in `protocols/shared/constants.ts` instead.

## What is implemented

|                                                                                 | NAVI Lending                   | Volo Vault             |
| ------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| `depositPTB`                                                                    | yes                            | yes                    |
| `withdrawPTB`                                                                   | yes, asset-denominated         | yes, share-denominated |
| `claimRewardsPTB`                                                               | yes                            | yes                    |
| `cancelDepositPTB` / `cancelWithdrawPTB`                                        | n/a — settles instantly        | yes                    |
| `getVault` / `getVaults` / `getPositions` / `getPendingRequests` / `getRewards` | backend-sourced, not yet wired | same                   |

## Notes that cost real money to learn

**Deposits and withdrawals are `M + R + 1` Move calls on NAVI Lending.** The contract
asserts that every registered market was synchronized and every active market reward rule
harvested in the _same_ transaction. Omitting one aborts `E_MARKET_NOT_READ` (10006) or
`E_REWARDS_NOT_COLLECTED` (10007). The builders emit that prologue for you.

**Withdrawals open with an oracle price update.** `withdraw` reaches NAVI's collateral
valuation, which asserts price validity even for a debt-free vault, and takes
`PriceOracle` immutably so it cannot refresh the price itself. Without the update the call
aborts 1502. The entrypoint is versioned, so it is resolved from
`@naviprotocol/lending` at runtime rather than hardcoded — an oracle upgrade needs no
release here.

**`max_shares` is passed as 0, which the contract reads as "no limit".** The common path
does not expose a slippage bound, matching how the NAVI vault backend calls the contract.
Compose `navi_vault::withdraw` through the protocol layer if you need one.

**Amounts are in the coin's smallest unit, as integer strings** — the same convention as
`@naviprotocol/lending`, whose `depositCoinPTB` also takes a raw `u64`. Nothing here
converts, so the builders need no `decimals` and cannot be off by a power of ten; a deposit
must equal the requested amount exactly or the contract aborts `E_AMOUNT_MISMATCH`. Callers
holding a human amount convert it with the exported `toBaseUnits`.

**A withdrawal can span several receipts.** Each receipt is an independent position, so a
request larger than any single one draws on more than one: receipts consumed in full are
passed `u64::MAX` so the contract drains them exactly, the last takes the remainder, and
the resulting coins are merged into one. Balances come from `get_user_balance` in a single
simulated block. Volo instead acts on the receipt with the most settled shares, matching
its backend — read as a dynamic field on the vault's `receipts` table, because the
contract's own getter returns a reference and is unreachable from a PTB.

**A deposit is funded with the vault's principal coin, and nothing else.** Both contracts'
`deposit` is generic over the vault's own `CoinType`, so there is no swap inside these
builders. Depositing another coin means swapping to the principal first and passing the
result as `options.coin` — a swap and a deposit compose in one transaction.

**A `Receipt` is a position, and the type is not generic** — one type covers every vault,
so attribution reads each object's `vault_address`. Omit `options.receipt` and the deposit
tops up the owner's existing position, or mints one when they hold none; passing every
deposit a fresh receipt is what leaves stray empty positions behind.

**Returned objects belong to the caller.** `deposit` yields `(Receipt, shares)` and
`withdraw` yields `(Coin, shares)`; both objects must be consumed by the transaction.

## Support

- Issues: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
