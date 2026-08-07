import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import {
  appendCollectRewardsPTB,
  appendFreshnessPTB,
  appendSyncMarketsPTB,
  claimRewardPTB,
  createTxContext,
  depositPTB,
  selectHarvestableRules,
  withdrawPTB
} from '../src'
import { CONFIG, descriptor, usdcHighYieldLayout } from './fixtures'

const USDC = descriptor('USDC')
const ctx = createTxContext(CONFIG, USDC)
const layout = usdcHighYieldLayout()

type MoveCall = {
  $kind: string
  MoveCall?: {
    package: string
    module: string
    function: string
    typeArguments: string[]
    arguments: unknown[]
  }
}

function commands(tx: Transaction): MoveCall[] {
  return tx.getData().commands as unknown as MoveCall[]
}

function moveCalls(tx: Transaction) {
  return commands(tx)
    .filter((command) => command.MoveCall)
    .map((command) => command.MoveCall!)
}

describe('appendSyncMarketsPTB', () => {
  it('emits one sync per registered market, Disabled ones included', () => {
    const tx = new Transaction()
    appendSyncMarketsPTB(tx, ctx, layout)

    const calls = moveCalls(tx)
    expect(calls).toHaveLength(layout.markets.length)
    expect(calls.every((call) => call.function === 'sync_market_balance')).toBe(true)
    expect(calls[0]!.module).toBe('navi_vault')
    expect(calls[0]!.typeArguments).toEqual([USDC.coinType])
  })

  it('targets the LATEST package, not the type-identity package', () => {
    const tx = new Transaction()
    appendSyncMarketsPTB(tx, ctx, layout)
    const call = moveCalls(tx)[0]!
    expect(call.package).toBe(CONFIG.package.packageId)
    expect(call.package).not.toBe(CONFIG.package.typePackageId)
  })

  it('takes market objects from the layout, not from configuration', () => {
    // The contract validates these against what it recorded and aborts 10017 otherwise,
    // so a config value that has drifted must not win.
    const drifted = {
      ...layout,
      markets: layout.markets.map((market, index) =>
        index === 0 ? { ...market, storageId: `0x${'9'.repeat(64)}` } : market
      )
    }
    const tx = new Transaction()
    appendSyncMarketsPTB(tx, ctx, drifted)
    // Arguments are Input references, so resolve them through the input table.
    expect(JSON.stringify(tx.getData().inputs)).toContain('9'.repeat(64))
  })
})

describe('appendCollectRewardsPTB', () => {
  it('harvests only active market rules', () => {
    const tx = new Transaction()
    appendCollectRewardsPTB(tx, ctx, selectHarvestableRules(layout, USDC))

    const calls = moveCalls(tx)
    // Rule 1 is inactive and vault-native; only rule 0 is harvestable.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.function).toBe('collect_reward')
    expect(calls[0]!.typeArguments).toEqual([USDC.coinType, layout.rules[0]!.rewardCoinType])
  })

  it('emits nothing for a vault with no rules', () => {
    const prime = descriptor('SUI_PRIME')
    const primeLayout = { ...layout, rules: [] }
    const tx = new Transaction()
    appendCollectRewardsPTB(
      tx,
      createTxContext(CONFIG, prime),
      selectHarvestableRules(primeLayout, prime)
    )
    expect(moveCalls(tx)).toHaveLength(0)
  })
})

describe('appendFreshnessPTB', () => {
  it('orders every sync before every harvest', () => {
    const tx = new Transaction()
    appendFreshnessPTB(tx, ctx, layout, selectHarvestableRules(layout, USDC))

    const names = moveCalls(tx).map((call) => call.function)
    expect(names).toEqual([
      ...Array(layout.markets.length).fill('sync_market_balance'),
      'collect_reward'
    ])
  })
})

describe('depositPTB', () => {
  it('wraps a new position in option::none and an existing one in option::some', () => {
    const fresh = new Transaction()
    depositPTB(fresh, ctx, {
      market: layout.markets[0]!,
      coin: fresh.splitCoins(fresh.gas, [fresh.pure.u64(1n)])[0]!,
      amount: 1n
    })
    expect(moveCalls(fresh).map((c) => c.function)).toContain('none')

    const existing = new Transaction()
    depositPTB(existing, ctx, {
      market: layout.markets[0]!,
      coin: existing.splitCoins(existing.gas, [existing.pure.u64(1n)])[0]!,
      amount: 1n,
      receipt: existing.object(`0x${'d'.repeat(64)}`)
    })
    expect(moveCalls(existing).map((c) => c.function)).toContain('some')
  })

  it('types the option by the ORIGINAL package — Receipt is not generic', () => {
    const tx = new Transaction()
    depositPTB(tx, ctx, {
      market: layout.markets[0]!,
      coin: tx.splitCoins(tx.gas, [tx.pure.u64(1n)])[0]!,
      amount: 1n
    })
    const option = moveCalls(tx).find((call) => call.function === 'none')!
    expect(option.typeArguments).toEqual([`${CONFIG.package.typePackageId}::navi_vault::Receipt`])
  })

  it('passes deposit arguments in the contract order', () => {
    const tx = new Transaction()
    depositPTB(tx, ctx, {
      market: layout.markets[0]!,
      coin: tx.splitCoins(tx.gas, [tx.pure.u64(123n)])[0]!,
      amount: 123n
    })
    const deposit = moveCalls(tx).find((call) => call.function === 'deposit')!
    // (vault, receipt_opt, clock, storage, pool, coin, amount, incentive_v2, incentive_v3)
    expect(deposit.arguments).toHaveLength(9)
    expect(deposit.typeArguments).toEqual([USDC.coinType])
  })
})

describe('withdrawPTB', () => {
  it('passes withdraw arguments in the contract order', () => {
    const tx = new Transaction()
    withdrawPTB(tx, ctx, {
      market: layout.markets[0]!,
      receipt: tx.object(`0x${'d'.repeat(64)}`),
      amount: 100n,
      maxShares: 110n,
      fromDefault: true
    })
    const call = moveCalls(tx)[0]!
    // (vault, receipt, clock, oracle, storage, pool, amount, max_shares, from_default,
    //  incentive_v2, incentive_v3, system_state)
    expect(call.function).toBe('withdraw')
    expect(call.arguments).toHaveLength(12)
  })
})

describe('claimRewardPTB', () => {
  it('carries both the vault coin type and the reward coin type', () => {
    const tx = new Transaction()
    claimRewardPTB(tx, ctx, {
      receipt: tx.object(`0x${'d'.repeat(64)}`),
      rewardCoinType: '0x2::sui::SUI'
    })
    const call = moveCalls(tx)[0]!
    expect(call.function).toBe('claim_reward')
    expect(call.typeArguments).toEqual([USDC.coinType, '0x2::sui::SUI'])
    expect(call.arguments).toHaveLength(3)
  })
})
