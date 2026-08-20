import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { createProtocolRegistry, VaultSdkError } from '../src'
import {
  CERT,
  certReward,
  clientWithReceipts,
  OWNER,
  RECEIPT,
  suiHighYield,
  suiPrime
} from './fixtures'

function registry(
  receipts: string[] = [],
  balances: Record<string, bigint> = {},
  vaultId?: string
) {
  return createProtocolRegistry({
    client: clientWithReceipts(receipts, balances, vaultId),
    env: 'prod',
    options: {}
  })
}

type MoveCall = {
  package: string
  module: string
  function: string
  typeArguments: string[]
  arguments: unknown[]
}

function moveCalls(tx: Transaction): MoveCall[] {
  return (tx.getData().commands as { MoveCall?: MoveCall }[])
    .filter((command) => command.MoveCall)
    .map((command) => command.MoveCall!)
}

describe('depositPTB', () => {
  it('emits every market sync, then every active harvest, then deposit', async () => {
    const vault = suiHighYield()
    const tx = new Transaction()
    await registry()['navi-lending'].depositPTB(tx, vault, OWNER, '0.1')

    const names = moveCalls(tx).map((call) => call.function)
    // M + R + 1, in order. Omitting a sync aborts 10006; omitting a harvest, 10007.
    expect(names).toEqual([
      'sync_market_balance',
      'sync_market_balance',
      'sync_market_balance',
      'collect_reward',
      'none',
      'deposit'
    ])
  })

  it('drops the harvest step for a vault with no reward rules', async () => {
    const tx = new Transaction()
    await registry()['navi-lending'].depositPTB(tx, suiPrime(), OWNER, '0.1')
    const names = moveCalls(tx).map((call) => call.function)
    expect(names.filter((name) => name === 'sync_market_balance')).toHaveLength(2)
    expect(names).not.toContain('collect_reward')
  })

  it('targets the LATEST package but types the receipt by the ORIGINAL one', async () => {
    const vault = suiHighYield()
    const tx = new Transaction()
    await registry()['navi-lending'].depositPTB(tx, vault, OWNER, '0.1')

    const deposit = moveCalls(tx).find((call) => call.function === 'deposit')!
    expect(deposit.package).toBe(vault.contractConfig.package)

    // Interchanging these fails silently in both directions.
    const option = moveCalls(tx).find((call) => call.function === 'none')!
    expect(option.typeArguments).toEqual([
      `${vault.contractConfig.initialPackageId}::navi_vault::Receipt`
    ])
  })

  it('tops up an existing receipt instead of minting a second one', async () => {
    const tx = new Transaction()
    await registry([RECEIPT])['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1')
    const names = moveCalls(tx).map((call) => call.function)
    expect(names).toContain('some')
    expect(names).not.toContain('none')
  })

  it('honours an explicit receipt without looking anything up', async () => {
    const exploding = {
      core: {
        listOwnedObjects: async () => {
          throw new Error('lookup should not happen')
        }
      }
    } as never
    const protocols = createProtocolRegistry({ client: exploding, env: 'prod', options: {} })
    const tx = new Transaction()
    await protocols['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1', {
      receipt: RECEIPT
    })
    expect(moveCalls(tx).map((call) => call.function)).toContain('some')
  })

  it('passes deposit arguments in the contract order', async () => {
    const tx = new Transaction()
    await registry()['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1')
    const deposit = moveCalls(tx).find((call) => call.function === 'deposit')!
    // (vault, receipt_opt, clock, storage, pool, coin, amount, incentive_v2, incentive_v3)
    expect(deposit.arguments).toHaveLength(9)
    expect(deposit.typeArguments).toEqual(['0x2::sui::SUI'])
  })

  it('rejects a non-principal deposit asset', async () => {
    // NAVI Lending's deposit is generic over the vault's own CoinType, so there is no
    // swap path; Volo is the protocol that accepts other coins.
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1', {
        coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
      })
    ).rejects.toThrow(/accepts only/)
  })

  it('rejects an amount finer than the coin precision', async () => {
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.0000000001')
    ).rejects.toThrow(VaultSdkError)
  })

  it('fails loudly when an active market rule has no reward fund configured', async () => {
    const vault = suiHighYield()
    const broken = {
      ...vault,
      contractConfig: {
        ...vault.contractConfig,
        naviLending: {
          ...vault.contractConfig.naviLending,
          rewardRules: [
            { ...vault.contractConfig.naviLending.rewardRules[0]!, rewardFundObjectId: undefined }
          ]
        }
      }
    }
    const tx = new Transaction()
    await expect(registry()['navi-lending'].depositPTB(tx, broken, OWNER, '0.1')).rejects.toThrow(
      /RewardFund/
    )
  })
})

describe('claimRewardsPTB', () => {
  it('harvests the matching rule then claims per receipt', async () => {
    const tx = new Transaction()
    await registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [certReward()])
    expect(moveCalls(tx).map((call) => call.function)).toEqual(['collect_reward', 'claim_reward'])
  })

  it('carries both the vault coin type and the reward coin type', async () => {
    const tx = new Transaction()
    await registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [certReward()])
    const claim = moveCalls(tx).find((call) => call.function === 'claim_reward')!
    expect(claim.typeArguments).toEqual(['0x2::sui::SUI', CERT])
    expect(claim.arguments).toHaveLength(3)
  })

  it('claims once per receipt', async () => {
    const other = `0x${'c'.repeat(64)}`
    const tx = new Transaction()
    await registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [
      certReward(RECEIPT),
      certReward(other)
    ])
    const claims = moveCalls(tx).filter((call) => call.function === 'claim_reward')
    expect(claims).toHaveLength(2)
    // One harvest covers both, since the index is per rule not per receipt.
    expect(moveCalls(tx).filter((call) => call.function === 'collect_reward')).toHaveLength(1)
  })

  it('refuses an empty selection rather than emitting a zero-value claim', async () => {
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [])
    ).rejects.toThrow(VaultSdkError)
  })
})

describe('operations NAVI Lending does not have', () => {
  it.each(['cancelDepositPTB', 'cancelWithdrawPTB'] as const)('%s throws', async (method) => {
    // NAVI Lending settles instantly, so there is no pending request to cancel.
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'][method](tx, suiHighYield(), OWNER, '1', RECEIPT)
    ).rejects.toThrow(/not implemented|not supported/i)
  })

  it('rejects a share-denominated withdrawal target', async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT])['navi-lending'].withdrawPTB(tx, suiHighYield(), OWNER, {
        kind: 'shares',
        shares: '1000'
      })
    ).rejects.toThrow(/asset amount, not shares/)
  })

  it('rejects cancelPendingDeposit on withdraw', async () => {
    const tx = new Transaction()
    await expect(
      registry([RECEIPT])['navi-lending'].withdrawPTB(
        tx,
        suiHighYield(),
        OWNER,
        { kind: 'all' },
        { cancelPendingDeposit: true }
      )
    ).rejects.toThrow(/settle instantly/)
  })
})

describe('receipt selection', () => {
  const SECOND = `0x${'7'.repeat(64)}`

  it('mints a new position when the owner holds none', async () => {
    const tx = new Transaction()
    await registry([])['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1')
    expect(moveCalls(tx).map((call) => call.function)).toContain('none')
  })

  it('tops up the only position when the owner holds one', async () => {
    const tx = new Transaction()
    await registry([RECEIPT])['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1')
    expect(moveCalls(tx).map((call) => call.function)).toContain('some')
  })

  it('credits the position holding the most when the owner holds several', async () => {
    // Matches the NAVI vault backend's fallback (receipts ordered by shares). Ordering by
    // balance also skips the empty receipts an earlier full exit leaves behind.
    const tx = new Transaction()
    await registry([RECEIPT, SECOND], { [RECEIPT]: 1n, [SECOND]: 9999n })[
      'navi-lending'
    ].depositPTB(tx, suiHighYield(), OWNER, '0.1')
    expect(JSON.stringify(tx.getData().inputs)).toContain(SECOND.slice(2))
  })

  it('honours an explicit receipt without reading balances', async () => {
    const tx = new Transaction()
    await registry([RECEIPT, SECOND])['navi-lending'].depositPTB(tx, suiHighYield(), OWNER, '0.1', {
      receipt: SECOND
    })
    expect(JSON.stringify(tx.getData().inputs)).toContain(SECOND.slice(2))
  })
})

describe('coin selection', () => {
  it('only splits gas for the actual gas coin', async () => {
    // 0x2 publishes coins that are not SUI; splitting one of those from gas would fund
    // the deposit with the wrong asset.
    const fake = {
      ...suiHighYield(),
      assets: { base: { coinType: '0x2::foo::BAR', decimals: 9 }, deposits: [] }
    }
    const tx = new Transaction()
    await registry()['navi-lending'].depositPTB(tx, fake, OWNER, '1')
    expect(JSON.stringify(tx.getData().commands)).not.toContain('GasCoin')
  })

  it('rejects useGasCoin for a non-SUI vault', async () => {
    const usdc = {
      ...suiHighYield(),
      assets: {
        base: {
          coinType:
            '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          decimals: 6
        },
        deposits: []
      }
    }
    const tx = new Transaction()
    await expect(
      registry()['navi-lending'].depositPTB(tx, usdc, OWNER, '1', { useGasCoin: true })
    ).rejects.toThrow(/useGasCoin only applies/)
  })
})

describe('claimRewardsPTB', () => {
  const SECOND = `0x${'7'.repeat(64)}`

  it('emits one claim per receipt and merges the coins', async () => {
    // Each claim returns a live Coin. Leaving all but one unconsumed makes the whole
    // transaction invalid, so same-type outputs are merged — as the backend does.
    const tx = new Transaction()
    await registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [
      certReward(RECEIPT),
      certReward(SECOND)
    ])
    const commands = tx.getData().commands as { $kind: string }[]
    expect(moveCalls(tx).filter((call) => call.function === 'claim_reward')).toHaveLength(2)
    expect(commands.some((command) => command.$kind === 'MergeCoins')).toBe(true)
  })

  it('does not merge when there is only one coin', async () => {
    const tx = new Transaction()
    await registry()['navi-lending'].claimRewardsPTB(tx, suiHighYield(), OWNER, [
      certReward(RECEIPT)
    ])
    const commands = tx.getData().commands as { $kind: string }[]
    expect(commands.some((command) => command.$kind === 'MergeCoins')).toBe(false)
  })
})
