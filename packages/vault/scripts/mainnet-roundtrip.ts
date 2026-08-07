/**
 * Mainnet round-trip validation for the vault transaction builders.
 *
 * MOVES REAL FUNDS. Run it yourself; never automate it. It exists to cover the two
 * things simulation cannot: gas estimation, and execution under contention.
 *
 * Every step simulates first and prints the projection. Nothing is submitted unless
 * --confirm is passed, and each submission is reported with its digest before the next
 * step runs.
 *
 * Usage:
 *
 *   export SUI_PRIVATE_KEY=suiprivkey1...        # bech32; never committed, never logged
 *
 *   # 1. dry run — simulates every step, submits nothing
 *   pnpm --filter @naviprotocol/vault roundtrip -- --vault=SUI_PRIME --amount=0.1
 *
 *   # 2. for real, one step at a time
 *   ... --vault=SUI_PRIME --amount=0.1 --step=deposit --confirm
 *   ... --vault=SUI_PRIME --step=claim   --confirm
 *   ... --vault=SUI_PRIME --step=exit    --confirm
 *
 * A deposit tops up the sender's existing position when they hold exactly one and opens a
 * new one when they hold none. Holding several is ambiguous — pass --position=<receiptId>
 * to pick one, or --position=new to open another.
 *
 * Recommended first target is SUI Prime: no reward rules, so the deposit block is six
 * commands. Deposit and full exit have both been executed against it on mainnet.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { createNaviSuiClient } from '@naviprotocol/lending'
import {
  buildClaimRewardTx,
  buildDepositTx,
  buildExitAllTx,
  findReceipts,
  estimateGas,
  formatUnits,
  getVaultConfig,
  getVaultLayout,
  getVaultPositions,
  getVaultQuote,
  parseVaultError,
  previewClaimReward,
  previewWithdraw,
  resolveVault,
  MAX_U64,
  sharePrice
} from '../src'
import type { VaultDescriptor } from '../src'

type Step = 'deposit' | 'claim' | 'exit'

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

const VAULT_KEY = arg('vault') ?? 'SUI_PRIME'
const AMOUNT_HUMAN = arg('amount') ?? '0.1'
const STEP = (arg('step') ?? 'all') as Step | 'all'
const CONFIRM = process.argv.includes('--confirm')
/**
 * Which position to credit: a receipt id, or 'new' to open a fresh one. Omit to let the
 * SDK reuse the sender's, if they hold exactly one.
 */
const POSITION = arg('position')

function toBaseUnits(human: string, decimals: number): bigint {
  const [whole = '0', fraction = ''] = human.split('.')
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals))
}

function loadKeypair(): Ed25519Keypair {
  const secret = process.env.SUI_PRIVATE_KEY
  if (!secret) {
    throw new Error('SUI_PRIVATE_KEY is not set. Export the bech32 suiprivkey1... value.')
  }
  // Never printed, never written anywhere.
  return Ed25519Keypair.fromSecretKey(secret)
}

const client = createNaviSuiClient() as never
const options = { client }

// Resolved inside main() so a missing key is reported by the handler below rather than
// as an uncaught top-level throw.
let keypair: Ed25519Keypair
let sender: string

type GasUsed = {
  computationCost?: string | number
  storageCost?: string | number
  storageRebate?: string | number
}

type ExecuteResult = {
  Transaction?: { digest?: string; effects?: { status?: unknown; gasUsed?: GasUsed } }
  FailedTransaction?: {
    digest?: string
    effects?: { status?: unknown; errors?: unknown[]; gasUsed?: GasUsed }
  }
}

/** Net gas a completed transaction actually charged, in MIST. */
function actualNetGas(gasUsed: GasUsed | undefined): bigint | undefined {
  if (!gasUsed) return undefined
  const n = (v: string | number | undefined) => BigInt(v ?? 0)
  return n(gasUsed.computationCost) + n(gasUsed.storageCost) - n(gasUsed.storageRebate)
}

async function submit(tx: Transaction, label: string, estimated?: bigint): Promise<string> {
  tx.setSenderIfNotSet(sender)
  const bytes = await tx.build({ client: client as never })
  const signed = await keypair.signTransaction(bytes)

  const core = (
    client as {
      core: {
        executeTransaction(input: unknown): Promise<ExecuteResult>
        waitForTransaction(input: unknown): Promise<unknown>
      }
    }
  ).core

  const result = await core.executeTransaction({
    transaction: bytes,
    signatures: [signed.signature],
    include: { effects: true, events: true, balanceChanges: true }
  })

  // The response is an envelope keyed by outcome, the same shape simulate returns —
  // `Transaction` on success, `FailedTransaction` otherwise. Both carry the digest.
  const failed = result.FailedTransaction
  const digest = (result.Transaction ?? failed)?.digest
  if (!digest) {
    throw new Error(`${label} returned no digest: ${JSON.stringify(result).slice(0, 300)}`)
  }
  if (failed) {
    throw new Error(`${label} failed on chain (${digest}): ${JSON.stringify(failed.effects)}`)
  }

  console.log(`   submitted ${label}: ${digest}`)
  console.log(`   https://suiscan.xyz/mainnet/tx/${digest}`)

  // Report what it actually cost, not just what was projected — validating gas is one of
  // the two things this script exists for, and an estimate alone cannot do that.
  const actual = actualNetGas(result.Transaction?.effects?.gasUsed)
  if (actual !== undefined) {
    const drift =
      estimated !== undefined && actual > 0n
        ? ` (estimate was ${formatUnits(estimated, 9)}, ` +
          `${estimated >= actual ? '+' : '-'}${
            Number(
              ((estimated > actual ? estimated - actual : actual - estimated) * 1000n) / actual
            ) / 10
          }%)`
        : ''
    console.log(`   actual gas ${formatUnits(actual, 9)} SUI${drift}`)
  }

  // Reads that follow must observe this transaction. Without the wait, the next report
  // can be served by a node that has not caught up and will show pre-transaction figures.
  await core.waitForTransaction({ digest })
  return digest
}

async function report(descriptor: VaultDescriptor, when: string): Promise<void> {
  const quote = await getVaultQuote(descriptor, options)
  const receipts = await findReceipts(sender, descriptor, options)
  const positions = await getVaultPositions(
    receipts.map((receipt) => receipt.objectId),
    descriptor,
    options
  )
  console.log(`\n── ${when} ──`)
  console.log(
    `   vault TVL ${formatUnits(quote.totalAssets, descriptor.decimals)} ` +
      `| share price ${sharePrice(quote).toFixed(9)}`
  )
  if (positions.length === 0) {
    console.log('   holder has no receipts')
  }
  for (const position of positions) {
    console.log(
      `   receipt ${position.receiptId.slice(0, 10)}… ` +
        `shares=${position.shares} balance=${formatUnits(position.balance, descriptor.decimals)}`
    )
  }
}

async function main(): Promise<void> {
  keypair = loadKeypair()
  sender = keypair.getPublicKey().toSuiAddress()

  const config = await getVaultConfig(options)
  const descriptor = resolveVault(VAULT_KEY, config)
  const amount = toBaseUnits(AMOUNT_HUMAN, descriptor.decimals)

  console.log(`vault    ${descriptor.displayName} (${descriptor.vault})`)
  console.log(`sender   ${sender}`)
  console.log(`amount   ${AMOUNT_HUMAN} (${amount} base units)`)
  console.log(`step     ${STEP}`)
  console.log(
    `mode     ${CONFIRM ? '*** SUBMITTING REAL TRANSACTIONS ***' : 'dry run (simulate only)'}`
  )

  const layout = await getVaultLayout(descriptor, options)
  if (layout.paused) throw new Error('Vault is paused.')
  console.log(
    `layout   version=${layout.version} markets=${layout.markets.length} ` +
      `rules=${layout.rules.length}`
  )

  await report(descriptor, 'before')

  if (STEP === 'all' || STEP === 'deposit') {
    console.log('\n[1] deposit')
    const tx = await buildDepositTx(
      {
        vault: descriptor,
        amount,
        sender,
        ...(POSITION ? { position: POSITION } : {})
      },
      options
    )
    console.log(`   commands: ${tx.getData().commands.length}`)
    // estimateGas simulates and throws on abort, so it doubles as the dry run.
    const gas = await estimateGas(tx, { ...options, sender })
    console.log(`   simulation OK  |  gas ~${formatUnits(gas.netCost, 9)} SUI`)
    if (CONFIRM) await submit(tx, 'deposit', gas.netCost)
  }

  const receipts = await findReceipts(sender, descriptor, options)
  const receiptId = POSITION && POSITION !== 'new' ? POSITION : receipts[0]?.objectId
  if (receipts.length > 1 && !POSITION) {
    console.log(
      `\n   note: sender holds ${receipts.length} receipts; steps below act on ` +
        `${receiptId?.slice(0, 10)}…. Pass --position=<id> to choose.`
    )
  }

  if ((STEP === 'all' || STEP === 'claim') && receiptId) {
    console.log('\n[2] claim rewards')
    const coinTypes = [
      ...new Set(layout.rules.filter((rule) => rule.isActive).map((rule) => rule.rewardCoinType))
    ]
    if (coinTypes.length === 0) console.log('   vault pays no rewards; skipping')
    for (const rewardCoinType of coinTypes) {
      const claimable = await previewClaimReward(
        { vault: descriptor, receiptId, rewardCoinType, sender },
        options
      )
      console.log(`   ${rewardCoinType} claimable=${claimable}`)
      if (claimable === 0n) {
        console.log('   nothing to claim; skipping to avoid a zero-valued coin object')
        continue
      }
      const tx = await buildClaimRewardTx(
        { vault: descriptor, receiptId, rewardCoinType, sender },
        options
      )
      const claimGas = await estimateGas(tx, { ...options, sender })
      if (CONFIRM) await submit(tx, 'claim', claimGas.netCost)
    }
  }

  if ((STEP === 'all' || STEP === 'exit') && receiptId) {
    console.log('\n[3] full exit')
    const preview = await previewWithdraw(
      { vault: descriptor, receiptId, amount: MAX_U64, sender },
      options
    )
    console.log(
      `   burns ${preview.sharesBurned} shares, returns ` +
        `${preview.amountOut !== undefined ? formatUnits(preview.amountOut, descriptor.decimals) : '?'} ` +
        `| maxShares ${preview.maxShares} (+${preview.toleranceBps}bps)`
    )
    const { transaction } = await buildExitAllTx({ vault: descriptor, receiptId, sender }, options)
    const exitGas = await estimateGas(transaction, { ...options, sender })
    console.log(
      `   commands: ${transaction.getData().commands.length}  |  ` +
        `gas ~${formatUnits(exitGas.netCost, 9)} SUI`
    )
    if (CONFIRM) await submit(transaction, 'exit', exitGas.netCost)
  }

  await report(descriptor, 'after')

  if (!CONFIRM) {
    console.log('\nDry run complete. Nothing was submitted. Re-run with --confirm to execute.')
  } else {
    console.log(
      '\nDone. A full exit normally clears the position exactly; only the sole remaining ' +
        'holder can be left with a remainder, because the virtual-share offset prevents ' +
        'them draining the vault in one transaction. Check the "after" figures either way.'
    )
  }
}

main().catch((error) => {
  const decoded = parseVaultError(error)
  if (decoded) {
    console.error(`\nFAILED [${decoded.name}/${decoded.code}] (${decoded.kind})`)
    console.error(decoded.message)
  } else {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exitCode = 1
})
