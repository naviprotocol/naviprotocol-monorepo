# @naviprotocol/vault

Unified TypeScript SDK for NAVI Lending vaults and Volo vaults on Sui.

## Install

```bash
npm install @naviprotocol/vault @mysten/sui
```

## Core Concepts

### Vault sources

Every `Vault` has a `source` (`'navi'` or `'volo'`) and a `protocol`
(`'navi' | 'volo' | 'astros'`). `source` picks which SDK code path runs — it is what the
top-level `depositPTB`/`withdrawPTB`/`getPositions` dispatch on. `protocol` is only the
strategy provider and is **not** a source discriminator: an `astros`-protocol vault is
still served through the `navi` or `volo` source.

### NAVI vaults vs. Volo vaults

The two sources settle very differently:

- **NAVI vaults** (`navi_vault` package) deposit straight into a NAVI lending market.
  Deposits and withdrawals execute synchronously in the same transaction; `withdrawPTB`
  returns the withdrawn coin directly.
- **Volo vaults** (`volo_vault` package) are asynchronous. `depositPTB`/`withdrawPTB`
  create a `DepositRequest`/`WithdrawRequest` that an operator executes later, at that
  point's exchange rate. `withdrawPTB` therefore returns the created request ids, not a
  coin. Pending requests can be cancelled with `cancelPendingDepositPTB` /
  `cancelPendingWithdrawPTB` once their lock (`PendingRequest.executeTime`) has passed.

Because Volo settles at a rate nobody knows at build time, `depositPTB` accepts an
`expectedShares` floor that the contract enforces on execution. NAVI has no equivalent —
the field is currently **ignored** for NAVI vaults rather than rejected, so only rely on it
when `vault.source === 'volo'`.

### Units

`depositPTB` accepts either a **human-readable decimal string** in the vault's base coin
(`"1.5"`, `"0.0002"`) or a `TransactionArgument` / `TransactionResult` containing a raw
base-unit amount. Transaction values must be paired with `options.coin`. Amount targets for
`withdrawPTB` remain human-readable decimal strings, while `{ kind: 'shares' }` takes a raw
on-chain share count. Literal raw `bigint` amounts live on the protocol-level namespaces
(`navi.depositPTB`, `volo.depositPTB`, ...).

### Common `options`

Most functions accept a trailing `options` object. Frequent fields:

- `client` — a `SuiGrpcClient` to read on-chain state through. Defaults to a mainnet client.
- `cacheTime` / `disableCache` — override the SDK's built-in response caching for that call.
- `protocols` / `vaults` — filter `getVaults`/`getPositions` results.

### Errors

All SDK failures throw `VaultSdkError` with a stable machine-readable `code`
(`VAULT_NOT_FOUND`, `INVALID_AMOUNT`, `INSUFFICIENT_BALANCE`, ...) — see
`VAULT_SDK_ERROR_CODES` and `isVaultSdkError` for narrowing a caught error.

## Usage

```ts
import { getVaults, getVault, depositPTB, withdrawPTB, getPositions } from '@naviprotocol/vault'
import { Transaction } from '@mysten/sui/transactions'

// Discover vaults (throws VaultSdkError with code VAULT_NOT_FOUND for unknown ids)
const vaults = await getVaults()
const vault = await getVault(vaults[0].id)

// Deposit: decimal strings are parsed in vault coin units. The receipt is transferred to
// owner automatically; inspect shares for NAVI or requestId for Volo.
const tx = new Transaction()
const deposit = await depositPTB(tx, vault, owner, '1.5')
console.log(deposit.shares ?? deposit.requestId)

// Withdraw by amount ("1.5" tokens), by raw share count, or everything
await withdrawPTB(tx, vault, owner, { kind: 'amount', amount: '1.5' })
await withdrawPTB(tx, vault, owner, { kind: 'shares', shares: '1000000' })
await withdrawPTB(tx, vault, owner, { kind: 'all' })

// Positions and pending Volo requests
const positions = await getPositions(owner)
```

## API Reference

### Vault discovery

- `getVaults(options?)` — list every vault the NAVI open API knows about.
- `getVault(idOrVault, options?)` — resolve a `VaultIdentifier` to a `Vault`.

### Deposit / withdraw

- `depositPTB(tx, vault, owner, amount, options?)` — build a deposit from a human-readable
  decimal amount or a PTB amount value. Returns `{ receipt, shares? }` for NAVI or
  `{ receipt, requestId? }` for Volo and transfers owned return objects to `owner`.
- `withdrawPTB(tx, vault, owner, target, options?)` — build a withdrawal, where `target` is
  `{ kind: 'amount', amount }`, `{ kind: 'shares', shares }`, or `{ kind: 'all' }`.

### Positions and rewards

- `getPositions(owner, options?)` — an owner's positions across all vaults.
- `getVaultRewards(vaultOrId, owner, options?)` — an owner's claimable/claimed rewards (NAVI vaults only).
- `claimRewardsPTB(tx, rewards, options?)` — build calls to harvest and claim NAVI vault rewards.

### Pending Volo requests

- `getPendingRequests(owner, options?)` — an owner's pending deposit/withdraw requests.
- `cancelPendingDepositPTB(tx, request)` — cancel a pending Volo deposit, returning the refunded coin.
- `cancelPendingWithdrawPTB(tx, request)` — cancel a pending Volo withdraw, returning the cancelled share count.

### Protocol namespaces

Raw base-unit builders and protocol-specific helpers live on the `navi` and `volo`
namespaces re-exported from the package root, e.g. `navi.depositPTB`, `navi.getVaultReceipts`,
`navi.getVaultRewardRules`, `volo.depositPTB`, `volo.getVaultReceipts`, `volo.getPendingRequests`.
See the generated API docs (`npm run typedoc`) for the full surface.

## License

MIT
