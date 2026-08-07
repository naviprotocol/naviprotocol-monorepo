# @naviprotocol/vault

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NAVI Vault SDK for the Sui blockchain. A vault accepts deposits of a single asset, issues proportional shares, and deploys the assets across one or more NAVI lending markets. Yield accrues to share value.

## Documentation

For SDK documentation visit http://sdk.naviprotocol.io/vault

## Installation

```npm
npm install @naviprotocol/vault
```

## Core Concepts

### Receipts, not share tokens

A position is a `Receipt` object, not a coin. Transferring the Receipt transfers the position. A holder may hold several Receipts against one vault; each is independent and they never merge.

`buildDepositTx` resolves which position to credit via the `position` argument:

| `position`   | Behaviour                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| omitted      | Reuse the sender's Receipt when they hold exactly one, mint a new one when they hold none. Several is ambiguous and raises an error listing them. Costs one extra read (~60ms). |
| a receipt id | Credit that position. No lookup.                                                                                                                                                |
| `'new'`      | Open a fresh position. No lookup.                                                                                                                                               |

Guessing among several is deliberately not done: a Receipt _is_ a position, merging two is not reversible in place, and silently topping one up is what leaves stray empty Receipts behind.

`Receipt` is **not generic** — a single type covers every vault on the deployment. Attributing one to a vault means reading its `vault_address` field, which matters concretely: two vaults share `0x2::sui::SUI` and two more share USDC.

### Snapshot accounting

A market position's value is a cached figure, written only by `sync_market_balance`. Between calls it understates the position by all interest accrued since. Because synchronization only happens as a side effect of someone transacting, an inactive vault can carry a snapshot weeks old.

Two consequences shape the whole API:

- **Deposits and withdrawals are multi-command blocks.** Every registered market must be synchronized and every active market reward rule harvested in the _same_ transaction, so a deposit is `M + R + 1` Move calls.
- **Prices come from simulation.** Every pricing helper evaluates a read-only block that synchronizes before reading. Reading the vault object's fields directly returns the stale figure with no indication of its age.

### Withdrawal routing

The idle balance is drawn down first; the chosen market supplies only the shortfall. Withdrawing from the default market carries no penalty; any other market applies its own, capped at 30%, to the portion actually taken from it.

A full exit uses `fromDefault` with `u64::MAX`, which the contract clamps to the holder's maximum. It normally clears the position exactly — verified on mainnet, shares and balance both reach zero.

The exception is the **sole remaining holder**. The virtual-share offset that blocks inflation attacks means redeeming the entire balance would require burning `total_shares + VIRTUAL_SHARES`, which they do not have, so they may need a second withdrawal or leave a small remainder. Multi-holder exits are unaffected. Either way, read the returned coin value or the post-exit balance rather than assuming.

## Usage

```ts
import { SuiGrpcClient, GrpcWebFetchTransport } from '@mysten/sui/grpc'
import {
  buildDepositTx,
  buildExitAllTx,
  findReceipts,
  getVaultQuote,
  sharePrice
} from '@naviprotocol/vault'

const client = new SuiGrpcClient({
  network: 'mainnet',
  transport: new GrpcWebFetchTransport({ baseUrl: 'https://fullnode.mainnet.sui.io:443' })
})

// Synchronized pricing
const quote = await getVaultQuote('USDC', { client })
console.log(quote.totalAssets, sharePrice(quote))

// Deposit 10 USDC (6 decimals)
const tx = await buildDepositTx({ vault: 'USDC', amount: 10_000_000n, sender }, { client })

// Full exit
const [receipt] = await findReceipts(sender, 'USDC', { client })
const { transaction } = await buildExitAllTx(
  { vault: 'USDC', receiptId: receipt.objectId, sender },
  { client }
)
```

## Code Style and Conventions

### Two layers

- `*PTB` functions are synchronous command emitters. They append Move calls to a transaction you own and perform no network I/O. Use them when you need a vault operation inside a larger block.
- `build*Tx` functions are async and assemble a complete, submittable transaction, including the freshness prologue and — for withdrawals — the oracle price update.

### Interface optional parameters

The last `options` parameter customizes behaviour:

- `client`: Sui SDK v2 client. Required for anything that reads chain state.
- `config`: overrides the bundled configuration snapshot for this call.
- `layout`: a `VaultLayout` already read during construction of the current transaction, skipping a round trip.
- `env`, `services`: forwarded to `@naviprotocol/lending` for oracle configuration.

### Configuration

The bundled `MAINNET_VAULT_CONFIG` snapshot is a fallback so the SDK works with no setup. It is not authoritative — `packageId` changes on every contract upgrade, and a stale value silently runs superseded code. Production deployments should supply their own via `configureVaultSdk`.

Live values — pause state, caps, fees, penalties, market membership, rule activity — are never read from configuration. They come from `getVaultLayout`, and **must not be cached across transactions**: `add_market` and `set_loss` both invalidate a layout in ways that make a transaction built from it abort.

Use `diffLayoutAgainstConfig` to detect drift between a configuration snapshot and chain.

### Units

| Quantity                                               | Scale                                      |
| ------------------------------------------------------ | ------------------------------------------ |
| Amounts (`amount`, `currentBalance`, `totalAssets`, …) | Token native decimals                      |
| `MarketLayout.loss`                                    | Always 9 decimals, regardless of the token |
| `managementFee`, `performanceFee`, `penalty`           | WAD — `1e18 = 100%`                        |
| `vaultRewardIndex`, `rewardRate`                       | RAY — `1e27`; rate is per millisecond      |
| `lastSyncAtMs`, `lastHarvestAtMs`                      | Milliseconds                               |
| Timelock timestamps                                    | Seconds                                    |

Raw on-chain integers are `bigint` throughout. `wadToPercent` and `formatUnits` are for display only.

### Slippage

`maxShares` bounds the shares a withdrawal burns. **`0n` means "no limit", not "no shares"** — the contract skips the check entirely. `buildWithdrawTx` rejects it rather than silently submitting an unprotected withdrawal.

Derive the bound by simulating: `convert_to_shares` models none of the market penalty, ceiling rounding, idle-first routing, or same-transaction fee accrual that determine what is actually burned. `buildWithdrawTxWithPreview` does this for you.

### Error classification

A vault transaction can abort from three packages, and the external codes are the ones most often misreported as user error:

| Code            | Meaning                                          | Treat as                                                                                                               |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `10001`–`10042` | `navi_vault`                                     | See `parseVaultError`                                                                                                  |
| `1400`          | Vault linked against a superseded `lending_core` | Protocol outage. Not recoverable client-side; suppress balances and block deposits until the vault package is upgraded |
| `1502`          | Oracle price outside its freshness window        | Transient; the withdrawal block needs its oracle prologue                                                              |
| `1506`          | NAVI reserve too utilized to release assets      | Transient liquidity, not the holder's balance                                                                          |
| `1604`          | NAVI reserve supply ceiling reached              | External cap, shared with other participants in that reserve                                                           |

```ts
import { parseVaultError, isProtocolOutage } from '@naviprotocol/vault'

const decoded = parseVaultError(error)
if (decoded?.kind === 'liquidity') {
  /* offer another market */
}
if (isProtocolOutage(error)) {
  /* stop quoting, stop accepting deposits */
}
```

## Status

Read paths — layout discovery, receipt attribution, quoting, previews — are verified against all four mainnet vaults.

Transaction builders are verified by **simulation against live mainnet state**: the deposit, full-exit and reward-claim blocks are executed through the Move VM with real vault state, real positions and real reward rules, covering both the no-rule shape (SUI Prime) and the harvest-required shape (SUI High Yield). Simulation discards the mutable references, so nothing is written and nothing is signed.

Deposit and full exit have additionally been **executed on mainnet** against SUI Prime — the deposit topped up an existing position without minting a second receipt, and the exit cleared the position to zero and returned the full balance. Gas came in at ~0.0033 SUI to top up, ~0.0070 SUI to open a new position, ~0.0045 SUI to exit.

Reward claim has been simulated but not executed, since the vaults carrying reward rules are not the ones used for validation.

`scripts/mainnet-roundtrip.ts` is the tool used for this. It moves real funds, so it is run manually and never automated — every step simulates first and prints the projection, and nothing is submitted without `--confirm`:

```bash
export SUI_PRIVATE_KEY=suiprivkey1...
pnpm --filter @naviprotocol/vault roundtrip -- --vault=SUI_PRIME --amount=0.1
```

That is a dry run. Add `--confirm` and `--step=deposit|claim|exit` to execute one step at a time. SUI Prime is the recommended first target: no reward rules, six commands, and a simulated full exit leaves a 1 mist remainder.

## Support

- Issues: [GitHub Issues](https://github.com/naviprotocol/naviprotocol-monorepo/issues)
