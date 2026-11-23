/**
 * 新流动性来源（alphafi stSUI / afSUI / haWAL）SDK E2E：SDK 拼的交易与"直接调协议入口"的参考交易在同一状态下 simulate，
 * 用户实际到账必须逐整数相等（证明 SDK 的 moveCall 目标、参数顺序、对象 ID 都对）。只读模拟，不签名不上链。
 *
 * 用例（报价是手工构造的单路由；amount_out 填 0 只影响滑点检查的期望值，这里 minAmountOut = 0）：
 *   SUI→stSUI→SUI   alphafi mint + redeem（两跳一条路由）
 *   SUI→afSUI→SUI   afSUI request_stake + request_unstake_atomic
 *   WAL→haWAL       haWAL request_stake_coin（输入用链上现成的 WAL 币，关掉所有权检查）
 * 后端算价器与链上逐整数一致的证明在 dex-aggregator-backend 的 tests/e2e/{alphafi,afSui,haWal}/。
 *
 * 用法：npx tsx tests/e2e/new-lst-sources.ts   产物：tests/e2e/reports/new-lst-sources-<时间>.json；有失败退出码 1。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig as C } from '../../src/libs/Aggregator/config'

const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const GQL = process.env.SUI_GRAPHQL_URL || 'https://graphql.mainnet.sui.io/graphql'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const SENDER =
  process.env.SENDER || '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
const RECEIVER = '0x000000000000000000000000000000000000000000000000000000000000beef'
const SUI = '0x2::sui::SUI'
const STSUI = C.stSuiCoinType
const AFSUI = '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI'
const WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
const HAWAL = '0x8b4d553839b219c3fd47608a0cc3d5fcc572cb25d41b7df3833208586a8d2470::hawal::HAWAL'
const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000000'
const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

type Hop = { provider: string; from: string; target: string; a2b: boolean }
const hop = (h: Hop) => ({
  id: '',
  type: '',
  fee_rate: 0,
  amount_in: 0,
  amount_out: 0,
  info_for_ptb: { typeArguments: [] },
  ...h
})

/** 参考交易：直接调协议入口（与后端算价器对照的同一组入口），最后读到账币值 */
function referenceCall(tx: Transaction, h: Hop, coin: any): any {
  if (h.provider === 'alphafi') {
    return h.a2b
      ? tx.moveCall({
          target: `${C.alphafiPackageId}::liquid_staking::mint`,
          typeArguments: [STSUI],
          arguments: [tx.object(C.alphafiLiquidStakingInfo), tx.object('0x5'), coin]
        })[0]
      : tx.moveCall({
          target: `${C.alphafiPackageId}::liquid_staking::redeem`,
          typeArguments: [STSUI],
          arguments: [tx.object(C.alphafiLiquidStakingInfo), coin, tx.object('0x5')]
        })[0]
  }
  if (h.provider === 'afSui') {
    return h.a2b
      ? tx.moveCall({
          target: `${C.afSuiPackageId}::staked_sui_vault::request_stake`,
          arguments: [
            tx.object(C.afSuiVault),
            tx.object(C.afSuiSafe),
            tx.object('0x5'),
            tx.object(C.afSuiReferralVault),
            coin,
            tx.pure.address(C.afSuiValidator)
          ]
        })[0]
      : tx.moveCall({
          target: `${C.afSuiPackageId}::staked_sui_vault::request_unstake_atomic`,
          arguments: [
            tx.object(C.afSuiVault),
            tx.object(C.afSuiSafe),
            tx.object(C.afSuiReferralVault),
            tx.object(C.afSuiTreasury),
            coin
          ]
        })[0]
  }
  if (h.provider === 'haWal') {
    return tx.moveCall({
      target: `${C.haWalPackageId}::walstaking::request_stake_coin`,
      arguments: [tx.object(C.walrusStaking), tx.object(C.haWalStaking), coin, tx.pure.id(ZERO_ID)]
    })[0]
  }
  throw new Error(h.provider)
}

async function topCoin(
  type: string,
  pages = 120
): Promise<{ id: string; balance: bigint; owner: string } | null> {
  let after: string | null = null
  let best: { id: string; balance: bigint; owner: string } | null = null
  for (let p = 0; p < pages; p++) {
    const res: any = await fetch(GQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'navi-ag-e2e/1.0' },
      body: JSON.stringify({
        query: `query($t:String!,$a:String){objects(first:50,after:$a,filter:{type:$t}){pageInfo{hasNextPage endCursor} nodes{address owner{... on AddressOwner{address{address}}} asMoveObject{contents{json}}}}}`,
        variables: { t: `0x2::coin::Coin<${type}>`, a: after }
      })
    }).then((r) => r.json())
    for (const n of res.data.objects.nodes) {
      const b = BigInt(n.asMoveObject?.contents?.json?.balance ?? 0)
      const owner = n.owner?.address?.address
      if (owner && (!best || b > best.balance)) best = { id: n.address, balance: b, owner }
    }
    if (!res.data.objects.pageInfo.hasNextPage) break
    after = res.data.objects.pageInfo.endCursor
  }
  return best
}

const STATE_IDS = [C.alphafiLiquidStakingInfo, C.afSuiVault, C.afSuiSafe, C.haWalStaking]
function versions(effects: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of [
    ...(effects?.changedObjects ?? []),
    ...(effects?.unchangedConsensusObjects ?? [])
  ])
    if (STATE_IDS.includes(o.objectId)) out[o.objectId] = String(o.inputVersion ?? o.version)
  return out
}

;(async () => {
  const wal = await topCoin(WAL)
  const cases: {
    name: string
    from: string
    target: string
    amount: bigint
    hops: Hop[]
    walCoin?: typeof wal
  }[] = [
    {
      name: 'SUI->stSUI->SUI 10 SUI',
      from: SUI,
      target: SUI,
      amount: 10n ** 10n,
      hops: [
        { provider: 'alphafi', from: SUI, target: STSUI, a2b: true },
        { provider: 'alphafi', from: STSUI, target: SUI, a2b: false }
      ]
    },
    {
      name: 'SUI->stSUI 500 SUI',
      from: SUI,
      target: STSUI,
      amount: 5n * 10n ** 11n,
      hops: [{ provider: 'alphafi', from: SUI, target: STSUI, a2b: true }]
    },
    {
      name: 'SUI->afSUI->SUI 20 SUI',
      from: SUI,
      target: SUI,
      amount: 2n * 10n ** 10n,
      hops: [
        { provider: 'afSui', from: SUI, target: AFSUI, a2b: true },
        { provider: 'afSui', from: AFSUI, target: SUI, a2b: false }
      ]
    },
    {
      name: 'SUI->afSUI 500 SUI',
      from: SUI,
      target: AFSUI,
      amount: 5n * 10n ** 11n,
      hops: [{ provider: 'afSui', from: SUI, target: AFSUI, a2b: true }]
    }
  ]
  if (wal && wal.balance >= 2n * 10n ** 9n) {
    cases.push({
      name: `WAL->haWAL ${wal.balance / 2n / 10n ** 9n} WAL`,
      from: WAL,
      target: HAWAL,
      amount: wal.balance / 2n,
      hops: [{ provider: 'haWal', from: WAL, target: HAWAL, a2b: true }],
      walCoin: wal
    })
  }
  const rows: any[] = []
  let failed = 0
  for (const c of cases) {
    const sender = c.walCoin ? c.walCoin.owner : SENDER
    const quote: any = {
      from: c.from,
      target: c.target,
      amount_in: c.amount.toString(),
      amount_out: '0',
      is_accurate: false,
      routes: [{ amount_in: Number(c.amount), amount_out: 0, path: c.hops.map(hop) }]
    }
    const inputOf = (tx: Transaction) =>
      c.walCoin
        ? tx.splitCoins(tx.object(c.walCoin.id), [tx.pure.u64(c.amount)])
        : tx.splitCoins(tx.gas, [tx.pure.u64(c.amount)])
    const tx = new Transaction()
    tx.setSender(sender)
    tx.setGasBudget(2_000_000_000n)
    const out = await buildSwapWithoutServiceFee(sender, tx, inputOf(tx) as any, quote, 0, 0, false)
    tx.transferObjects([out as any], RECEIVER)
    const ref = new Transaction()
    ref.setSender(sender)
    let coin: any = inputOf(ref)
    for (const h of c.hops) coin = referenceCall(ref, h, coin)
    ref.moveCall({ target: '0x2::coin::value', typeArguments: [c.target], arguments: [coin] })
    ref.transferObjects([coin], RECEIVER)
    const [sdkSim, refSim]: any[] = await Promise.all([
      client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: !c.walCoin,
        include: { effects: true, balanceChanges: true }
      } as any),
      client.core.simulateTransaction({
        transaction: ref,
        checksEnabled: false,
        include: { effects: true, commandResults: true }
      } as any)
    ])
    const s = sdkSim.Transaction ?? sdkSim.FailedTransaction
    const r = refSim.Transaction ?? refSim.FailedTransaction
    const row: any = {
      case: c.name,
      sdkOk: Boolean(s?.status?.success),
      refOk: Boolean(r?.status?.success)
    }
    if (!row.sdkOk) row.sdkError = JSON.stringify(s?.status?.error).slice(0, 300)
    if (!row.refOk) row.refError = JSON.stringify(r?.status?.error).slice(0, 300)
    row.received = (sdkSim.balanceChanges ?? s?.balanceChanges ?? [])
      .filter((b: any) => norm(b.coinType) === norm(c.target) && b.address === RECEIVER)
      .reduce((t: bigint, b: any) => t + BigInt(b.amount), 0n)
      .toString()
    if (row.refOk) {
      const vi = refSim.commandResults.length - 2
      row.reference = Buffer.from(refSim.commandResults[vi].returnValues[0].bcs)
        .readBigUInt64LE(0)
        .toString()
    }
    const vs = versions(s?.effects)
    const vr = versions(r?.effects)
    row.sameState = Object.keys(vs).length > 0 && Object.keys(vs).every((k) => vs[k] === vr[k])
    row.result =
      !row.sdkOk || !row.refOk
        ? 'fail'
        : !row.sameState
          ? 'pass_state_moved'
          : row.received === row.reference
            ? 'pass'
            : 'fail'
    if (row.result === 'fail') failed++
    rows.push(row)
    console.log(
      `${row.result.toUpperCase().padEnd(16)} ${c.name.padEnd(26)} received=${row.received} reference=${row.reference ?? row.refError}${row.sdkError ? ` sdkErr=${row.sdkError.slice(0, 200)}` : ''}`
    )
  }
  if (!cases.some((c) => c.walCoin)) console.log('SKIP WAL->haWAL: no WAL coin found')
  mkdirSync('tests/e2e/reports', { recursive: true })
  const file = `tests/e2e/reports/new-lst-sources-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ sender: SENDER, rows }, null, 1))
  console.log(`${rows.length - failed}/${rows.length} pass -> ${file}`)
  process.exit(failed ? 1 : 0)
})()
