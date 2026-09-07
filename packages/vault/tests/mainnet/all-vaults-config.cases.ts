import { Transaction } from '@mysten/sui/transactions'
import { describe, expect, it } from 'vitest'
import { navi, volo } from '../../src'
import { client, getMainnetContext, report, runLiveTests } from './context'

type Row = {
  id: string
  name: string
  source: string
  protocol: string
  status: string | null
  result: 'passed' | 'failed'
  detail: string
}

describe.skipIf(!runLiveTests)('configuration matrix', () => {
  it('resolves on-chain configuration for every live vault', async () => {
    const { vaults } = getMainnetContext()
    const rows: Row[] = []

    for (const vault of vaults) {
      const base = {
        id: vault.id,
        name: vault.name,
        source: vault.source,
        protocol: vault.protocol,
        status: vault.status
      }
      try {
        if (vault.source === 'navi') {
          // Everything depositPTB/withdrawPTB read before touching a coin: default pool
          // (possibly in a non-main lending market), reward rules, and the sync/harvest prologue.
          const pool = await navi.getVaultDefaultPool(vault, { client })
          const rules = await navi.getVaultRewardRules(vault, { client })
          const tx = new Transaction()
          await navi.syncMarketBalancePTB(tx, vault, { client })
          await navi.collectNaviRewardsPTB(tx, vault, { client })
          rows.push({
            ...base,
            result: 'passed',
            detail: `default pool ${pool.contract.pool} in lending market "${pool.market}"; ${
              rules.filter((rule) => rule.isActive).length
            }/${rules.length} active reward rule(s); prologue builds ${tx.getData().commands.length} call(s)`
          })
        } else {
          const view = await volo.readVoloVaultView(client, vault)
          const pending = await volo.getPendingRequests(vault, '0x0', { client })
          rows.push({
            ...base,
            result: 'passed',
            detail: `receipts table ${view.receiptsTableId}; withdraw lock ${view.lockingTimeForWithdrawMs} ms; request buffer readable (${pending.length} request(s) attributed to 0x0)`
          })
        }
      } catch (error) {
        rows.push({
          ...base,
          result: 'failed',
          detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        })
      }
    }

    const failed = rows.filter((row) => row.result === 'failed')
    report.add({
      api: 'configuration matrix',
      title: 'Resolve on-chain configuration for every live vault',
      status: failed.length ? 'failed' : 'passed',
      purpose:
        'Exercise the read path every PTB builder depends on, for all vaults the Open API lists, so a vault whose pool, market, reward rule, or table cannot be resolved is caught without needing a funded depositor.',
      data: { vaultCount: rows.length, rows },
      validations: [
        'Every NAVI vault resolves its default pool through @naviprotocol/lending, including pools outside the main market.',
        'Every active NAVI reward rule resolves its pool and reward fund, and the sync/harvest prologue builds.',
        'Every Volo vault exposes its receipts table, withdraw lock, and request buffer.'
      ],
      reason: failed.length ? `${failed.length} vault(s) failed to resolve` : undefined
    })
    expect(failed).toEqual([])
  }, 180_000)
})
