import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vault } from '../../src/types'

vi.mock('../../src/protocols/volo/receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/protocols/volo/receipt')>()
  return { ...actual, getVaultReceiptsWithView: vi.fn() }
})

import { depositPTB, withdrawPTB } from '../../src/protocols/volo/ptb'
import {
  RECEIPT_STATUS,
  getVaultReceiptsWithView,
  type VaultReceipt
} from '../../src/protocols/volo/receipt'
import { isVaultSdkError } from '../../src/error'

const OWNER = normalizeSuiAddress('0xabcd')
const PACKAGE = normalizeSuiAddress('0x7518')
const RECORDER = normalizeSuiAddress('0x7007')
const REWARD_MANAGER = normalizeSuiAddress('0x85c9')
const COIN_TYPE = '0x2::sui::SUI'

const vault: Vault = {
  id: normalizeSuiAddress('0x9e5f'),
  source: 'volo',
  protocol: 'volo',
  name: 'SUI MULTI STRATEGY',
  riskLevel: null,
  status: 'open',
  apy: { avg7d: null, avg30d: null, instant: null, target: null },
  assets: { baseCoin: { coinType: COIN_TYPE, decimals: 9, symbol: 'SUI' } },
  // 1000 SUI staked against 2e12 shares -> 2 shares per raw unit
  totalStaked: 1000,
  totalStakedUsd: null,
  totalShares: '2000000000000',
  exchangeRate: null,
  coinPrice: null,
  minInvestment: null,
  stakeCapAmount: null,
  lockup: null,
  volo: { package: PACKAGE, rewardManager: REWARD_MANAGER, statusRecord: RECORDER }
}

function receipt(
  id: string,
  shares: bigint,
  status: number = RECEIPT_STATUS.NORMAL,
  lastDepositTime = 0
): VaultReceipt {
  return { id: normalizeSuiAddress(id), shares, status, pendingWithdrawShares: 0n, lastDepositTime }
}

function mockReceipts(receipts: VaultReceipt[], lockingTimeForWithdrawMs = 0) {
  vi.mocked(getVaultReceiptsWithView).mockResolvedValue({
    view: receipts.length
      ? { receiptsTableId: normalizeSuiAddress('0x7ab1e'), lockingTimeForWithdrawMs }
      : null,
    receipts
  })
}

type MoveCallCommand = {
  package: string
  module: string
  function: string
  typeArguments: string[]
  arguments: unknown[]
}

function moveCalls(tx: Transaction): MoveCallCommand[] {
  return tx
    .getData()
    .commands.filter((command) => command.$kind === 'MoveCall')
    .map((command) => command.MoveCall as MoveCallCommand)
}

function target(call: MoveCallCommand) {
  return `${call.module}::${call.function}`
}

/** The object id an `Input`-kind argument was built from, before on-chain resolution. */
function inputObjectId(tx: Transaction, argument: unknown): string | undefined {
  const index = (argument as { Input?: number }).Input
  if (index === undefined) return undefined
  return JSON.stringify(tx.getData().inputs[index]).match(/0x[0-9a-f]{64}/)?.[0]
}

/** Decode the u256 a `Pure` input argument carries. */
function pureU256(tx: Transaction, argument: unknown): string {
  const index = (argument as { Input: number }).Input
  const input = tx.getData().inputs[index]
  expect(input.$kind).toBe('Pure')
  return bcs.u256().parse(fromBase64(input.Pure!.bytes))
}

/** Decode the u64 a `Pure` input argument carries. */
function pureU64(tx: Transaction, argument: unknown): string {
  const index = (argument as { Input: number }).Input
  const input = tx.getData().inputs[index]
  expect(input.$kind).toBe('Pure')
  return bcs.u64().parse(fromBase64(input.Pure!.bytes))
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise
    return undefined
  } catch (error) {
    return isVaultSdkError(error)
      ? { code: error.code, details: error.details }
      : { code: `non-sdk:${String(error)}` }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('volo.depositPTB call shape (user_entry::deposit + recorder)', () => {
  it('reuses the smallest eligible receipt and records the request with the contract-returned id', async () => {
    mockReceipts([
      receipt('0xb16', 100n),
      receipt('0x5a11', 5n, RECEIPT_STATUS.PENDING_DEPOSIT), // ineligible: mid-deposit (5017 on chain)
      receipt('0xa1d', 50n)
    ])
    const tx = new Transaction()
    const coin = tx.object(normalizeSuiAddress('0xc0ffee'))

    await depositPTB(tx, vault, OWNER, 1_000_000_000n, { coin, expectedShares: 7n })

    const calls = moveCalls(tx)
    expect(calls.map(target)).toEqual([
      'option::some',
      'user_entry::deposit',
      'vault_deposit_recorder::record_user_deposit_v2'
    ])

    const some = calls[0]
    expect(inputObjectId(tx, some.arguments[0])).toBe(normalizeSuiAddress('0xa1d'))

    const deposit = calls[1]
    expect(deposit.package).toBe(PACKAGE)
    expect(deposit.typeArguments).toEqual([COIN_TYPE])
    // (vault, reward_manager, coin, amount u64, expected_shares u256, Option<Receipt>, clock)
    expect(deposit.arguments).toHaveLength(7)
    expect(inputObjectId(tx, deposit.arguments[0])).toBe(vault.id)
    expect(inputObjectId(tx, deposit.arguments[1])).toBe(REWARD_MANAGER)
    expect(inputObjectId(tx, deposit.arguments[2])).toBe(normalizeSuiAddress('0xc0ffee'))
    expect(deposit.arguments[5]).toEqual({ $kind: 'Result', Result: 0 })
    expect(inputObjectId(tx, deposit.arguments[6])).toBe(normalizeSuiAddress('0x6'))

    const record = calls[2]
    expect(record.package).toBe(RECORDER)
    // (vault_id, request_id u64, user, source String, amount u64)
    expect(record.arguments).toHaveLength(5)
    expect(record.arguments[1]).toEqual({ $kind: 'NestedResult', NestedResult: [1, 0] })
  })

  it('asks the contract to mint a receipt when every existing one is ineligible', async () => {
    // Regression: without the status filter this passed a mid-deposit receipt and aborted with 5017.
    mockReceipts([
      receipt('0xa', 10n, RECEIPT_STATUS.PENDING_DEPOSIT),
      receipt('0xb', 20n, RECEIPT_STATUS.PARALLEL_PENDING_DEPOSIT_WITHDRAW)
    ])
    const tx = new Transaction()
    await depositPTB(tx, vault, OWNER, 1n, { coin: tx.object(normalizeSuiAddress('0xc0ffee')) })
    expect(moveCalls(tx).map(target)).toEqual([
      'option::none',
      'user_entry::deposit',
      'vault_deposit_recorder::record_user_deposit_v2'
    ])
  })
})

describe('volo.withdrawPTB call shape (user_entry::withdraw_with_auto_transfer + recorder)', () => {
  const now = Date.now()

  it('excludes pending-withdraw and locked receipts, then plans across the rest', async () => {
    mockReceipts(
      [
        receipt('0xf4ee', 100n),
        receipt('0x9e4d', 100n, RECEIPT_STATUS.PENDING_WITHDRAW),
        receipt('0x10c4ed', 100n, RECEIPT_STATUS.NORMAL, now)
      ],
      3_600_000
    )
    const tx = new Transaction()

    const result = await codeOf(withdrawPTB(tx, vault, OWNER, { kind: 'shares', shares: 150n }))
    expect(result?.code).toBe('INSUFFICIENT_BALANCE')
    expect(result?.details).toMatchObject({
      requestedShares: '150',
      uncoveredShares: '50',
      excludedReceipts: [
        { id: normalizeSuiAddress('0x9e4d'), reason: 'a withdraw request is already pending' },
        { id: normalizeSuiAddress('0x10c4ed'), reason: 'locked since the last executed deposit' }
      ]
    })
  })

  it('emits one withdraw + one record per planned receipt with the contract argument order', async () => {
    mockReceipts([receipt('0xa', 30n), receipt('0xb', 100n)])
    const tx = new Transaction()

    const requestIds = await withdrawPTB(tx, vault, OWNER, { kind: 'shares', shares: 50n })
    expect(requestIds).toHaveLength(2)

    const calls = moveCalls(tx)
    expect(calls.map(target)).toEqual([
      'user_entry::withdraw_with_auto_transfer',
      'vault_deposit_recorder::record_user_withdraw_v2',
      'user_entry::withdraw_with_auto_transfer',
      'vault_deposit_recorder::record_user_withdraw_v2'
    ])
    for (const withdraw of [calls[0], calls[2]]) {
      expect(withdraw.package).toBe(PACKAGE)
      expect(withdraw.typeArguments).toEqual([COIN_TYPE])
      // (vault, shares u256, expected_amount u64, receipt, clock)
      expect(withdraw.arguments).toHaveLength(5)
      expect(inputObjectId(tx, withdraw.arguments[0])).toBe(vault.id)
      expect(inputObjectId(tx, withdraw.arguments[4])).toBe(normalizeSuiAddress('0x6'))
    }
    // smallest-first: drain 0xa (30) then take 20 from 0xb
    expect(inputObjectId(tx, calls[0].arguments[3])).toBe(normalizeSuiAddress('0xa'))
    expect(pureU256(tx, calls[0].arguments[1])).toBe('30')
    expect(inputObjectId(tx, calls[2].arguments[3])).toBe(normalizeSuiAddress('0xb'))
    expect(pureU256(tx, calls[2].arguments[1])).toBe('20')
    expect(calls[1].arguments).toHaveLength(5)
    expect(calls[1].arguments[1]).toEqual({ $kind: 'Result', Result: 0 })
  })

  it('prices an amount target from the API totalStaked/totalShares snapshot', async () => {
    mockReceipts([receipt('0xa', 1_000n)])
    const tx = new Transaction()
    // 10 raw units * 2e12 shares / 1e12 raw = 20 shares
    await withdrawPTB(tx, vault, OWNER, { kind: 'amount', amount: 10n })
    expect(pureU256(tx, moveCalls(tx)[0].arguments[1])).toBe('20')
  })

  it('leaves the payout floor at zero unless the caller sets one', async () => {
    mockReceipts([receipt('0xa', 1_000n)])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'shares', shares: 100n })
    expect(pureU64(tx, moveCalls(tx)[0].arguments[2])).toBe('0')
  })

  it('divides one minAmountOut across the receipts the withdrawal spans', async () => {
    mockReceipts([receipt('0xa', 30n), receipt('0xb', 100n)])
    const tx = new Transaction()

    // 50 shares drawn as 30 + 20, so the floor splits 3:2. Each call carries its own
    // expected_amount, so passing the full floor to both would demand 2x the payout.
    await withdrawPTB(tx, vault, OWNER, { kind: 'shares', shares: 50n }, { minAmountOut: 1_000n })

    const calls = moveCalls(tx)
    expect(pureU64(tx, calls[0].arguments[2])).toBe('600')
    expect(pureU64(tx, calls[2].arguments[2])).toBe('400')
  })

  it('gives the remainder of an uneven split to the last call, so the floor is never lowered', async () => {
    mockReceipts([receipt('0xa', 1n), receipt('0xb', 1n), receipt('0xc', 1n)])
    const tx = new Transaction()
    await withdrawPTB(tx, vault, OWNER, { kind: 'shares', shares: 3n }, { minAmountOut: 10n })

    const floors = moveCalls(tx)
      .filter((call) => call.function === 'withdraw_with_auto_transfer')
      .map((call) => BigInt(pureU64(tx, call.arguments[2])))
    expect(floors).toEqual([3n, 3n, 4n])
    expect(floors.reduce((sum, floor) => sum + floor, 0n)).toBe(10n)
  })

  it('fails closed when the vault has no priced supply', async () => {
    mockReceipts([receipt('0xa', 1_000n)])
    const result = await codeOf(
      withdrawPTB(new Transaction(), { ...vault, totalStaked: 0 }, OWNER, {
        kind: 'amount',
        amount: 10n
      })
    )
    expect(result?.code).toBe('VAULT_CONFIG_INVALID')
  })
})
