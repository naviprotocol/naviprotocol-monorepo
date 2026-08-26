# @naviprotocol/vault

Unified TypeScript SDK for NAVI Lending vaults and Volo vaults on Sui.

## Install

```bash
npm install @naviprotocol/vault @mysten/sui
```

## Usage

```ts
import { getVaults, getVault, depositPTB, withdrawPTB, getPositions } from '@naviprotocol/vault'
import { Transaction } from '@mysten/sui/transactions'

// Discover vaults (throws VaultSdkError with code VAULT_NOT_FOUND for unknown ids)
const vaults = await getVaults()
const vault = await getVault(vaults[0].id)

// Deposit: amounts are human-readable decimal strings in vault coin units
const tx = new Transaction()
await depositPTB(tx, vault, owner, '1.5')

// Withdraw by amount ("1.5" tokens), by raw share count, or everything
await withdrawPTB(tx, vault, owner, { kind: 'amount', amount: '1.5' })
await withdrawPTB(tx, vault, owner, { kind: 'shares', shares: '1000000' })
await withdrawPTB(tx, vault, owner, { kind: 'all' })

// Positions and pending Volo requests
const positions = await getPositions(owner)
```

Raw base-unit builders and protocol-specific helpers live on the `navi` and `volo`
namespaces (`navi.depositPTB`, `volo.getVaultReceipts`, ...).

NAVI vault withdrawals return the withdrawn coin; Volo withdrawals create asynchronous
requests (settled by an operator) and return the created request ids. Pending Volo
requests can be cancelled with `cancelPendingDepositPTB` / `cancelPendingWithdrawPTB`
once their lock expires.

All SDK failures throw `VaultSdkError` with a stable machine-readable `code`
(`VAULT_NOT_FOUND`, `INVALID_AMOUNT`, `INSUFFICIENT_BALANCE`, ...) — see
`VAULT_SDK_ERROR_CODES`.

## License

MIT
