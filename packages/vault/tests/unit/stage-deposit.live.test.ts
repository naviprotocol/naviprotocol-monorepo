import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { navi } from '../../src'
import type { Vault } from '../../src/types'

/**
 * Opt-in live check (network): builds, without signing, a deposit PTB for the USDC High Yield
 * stage vault on the stage lending env and prints the move-call targets.
 * Run: VAULT_STAGE_LIVE=1 [VAULT_STAGE_OWNER=0x...] pnpm test -- --run tests/unit/stage-deposit.live.test.ts
 */
const stageVault: Vault = {
  id: '0x61f130e6f41ba89dfcee02e5050760f8543952ffdebaa3b1c02f02b89f73f8f0',
  source: 'navi',
  protocol: 'navi',
  name: 'USDC High Yield (stage)',
  riskLevel: null,
  status: 'active',
  apy: { avg7d: null, avg30d: null, instant: null, target: null },
  assets: {
    baseCoin: {
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      symbol: 'USDC'
    }
  },
  totalStaked: null,
  totalStakedUsd: null,
  totalShares: null,
  exchangeRate: null,
  coinPrice: null,
  minInvestment: null,
  stakeCapAmount: null,
  lockup: null,
  navi: {
    package: '0x9938904b0c45e95f85fe8cddd8587b199ab374aedc5dcd498e9d109b048402dd',
    originalPackage: '0xbdfc75fc3a644cede12b977e9af54eb09410380bafc439fbdb072d2e73dd40ef',
    lendingEnv: 'dev'
  }
}

describe.skipIf(!process.env.VAULT_STAGE_LIVE)('stage vault deposit PTB (live, not signed)', () => {
  it('builds a deposit against the stage deployment', async () => {
    const tx = new Transaction()
    const owner = process.env.VAULT_STAGE_OWNER ?? '0x1'
    const coin = tx.object('0x2')
    await navi.depositPTB(tx, stageVault, owner, 1_000_000n, { coin })
    const calls = tx
      .getData()
      .commands.flatMap((c) => (c.$kind === 'MoveCall' ? [c.MoveCall] : []))
      .map((c) => `${c.package}::${c.module}::${c.function}<${c.typeArguments.join(',')}>`)
    console.log(calls.join('\n'))
    expect(calls.some((c) => c.includes('::navi_vault::deposit'))).toBe(true)
  })
})
