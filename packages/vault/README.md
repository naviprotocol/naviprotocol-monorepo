# @naviprotocol/vault

Unified TypeScript SDK for NAVI Lending vaults and Volo vaults on Sui. Vault discovery, positions, deposits and withdrawals, reward claiming, and pending request management behind one set of interfaces.

## Install

```bash
npm install @naviprotocol/vault @mysten/sui
```

`@mysten/sui` is a peer dependency (`>=2.16.0`).

## Usage

```ts
import { getVaults, depositPTB, withdrawPTB, getPositions } from '@naviprotocol/vault'
import { Transaction } from '@mysten/sui/transactions'

const vaults = await getVaults()
const vault = vaults[0]

// Deposit: decimal strings are parsed in vault coin units. The receipt is transferred to
// owner automatically; inspect shares for NAVI or requestId for Volo.
const tx = new Transaction()
const deposit = await depositPTB(tx, vault, owner, '1.5')
console.log(deposit.shares ?? deposit.requestId)

// Withdraw by amount, by raw share count, or everything
await withdrawPTB(tx, vault, owner, { kind: 'amount', amount: '1.5' })

const positions = await getPositions(owner)
```

Builders with a `PTB` suffix append calls to a `Transaction` you pass in; they never sign or execute.

## One thing to know before you start

Every `Vault` carries two discriminators, and mixing them up is the most common integration mistake:

- **`source`** (`'navi' | 'volo'`) — which SDK code path and Move package back the vault. This is what the builders dispatch on.
- **`protocol`** (`'navi' | 'volo' | 'astros'`) — the strategy provider. A labelling field only; an `astros`-protocol vault is still served through the `navi` or `volo` source.

**Branch on `source`, filter on `protocol`.** The two sources also settle differently — NAVI in the same transaction, Volo through a request an operator executes later — which changes what every builder returns.

## Documentation

- [Guides](https://sdk.naviprotocol.io/vault) — concepts, units, slippage, error handling
- [API reference](https://sdk.naviprotocol.io/typedoc/modules/_naviprotocol_vault.html) — every export, generated from source

All failures throw `VaultSdkError` with a stable machine-readable `code`; use `isVaultSdkError` to narrow a caught error.

## License

MIT
