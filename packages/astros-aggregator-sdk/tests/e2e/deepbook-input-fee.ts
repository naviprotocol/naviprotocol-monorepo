/**
 * E2E（tests/e2e/deepbook-input-fee-failure-modes.md S1 / S2 / S6）：SDK 拼的 DeepBook 交易在主网可执行，且收到的币 = 参考调用。
 *
 * 每个用例：
 *   1. 向后端要 version 18、providers=deepbook 的报价（只读）。
 *   2. 用本 SDK 的 buildSwapWithoutServiceFee 拼整笔交易，输出转给单独的收款地址（目标币是 SUI 时不和 gas 混在一起）；
 *      用持币的真实地址、打开检查在主网 simulate（不签名、不广播）。打开检查才能发现没消费的返回值（S2）。
 *      输入币：SUI 从 gas 切，其他币用 coinWithBalance 从发送方的币里取。
 *   3. 同时 simulate 参考交易：同一路由，每跳直接调 v9 `pool::swap_exact_*`、DEEP 传 0（后端 input_fee 报价已对拍过的调用）。
 * 判据：SDK 交易成功；没有触碰赞助池 DeepPool；两笔读到的 DeepBook 池子版本相同时，收款地址收到的目标币 = 参考输出。
 * 报价副本的 is_accurate 置为 false：正向滑点只在 is_accurate=true 时开启，关掉才能逐整数比较。
 * 覆盖 a2b / b2a、多跳，以及 DEEP 作输入（DEEP 既是输入币又是手续费币，再额外传一个 0 DEEP）。
 *
 * 用法（在 packages/astros-aggregator-sdk 下）：npx tsx tests/e2e/deepbook-input-fee.ts
 *   AG_API 覆盖后端（默认生产开放 API）；SENDER 覆盖发送方（默认 tests/aggregator.test.ts 里的 DEEP holder，同时持有 SUI / USDC / DEEP）；
 *   SUI_GRPC_URL 覆盖节点
 * 产物：tests/e2e/reports/deepbook-input-fee-<时间>.json；有失败时退出码 1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig } from '../../src/libs/Aggregator/config'

const AG_API = process.env.AG_API || 'https://open-aggregator-api.naviprotocol.io'
const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const SENDER =
  process.env.SENDER || '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
const RECEIVER = '0x000000000000000000000000000000000000000000000000000000000000beef'
const V9 = '0xbca0cefe720330e7bb4f2283438b68de6a0e656688db4ac90d61e71fe6151fe8'
const DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
const SUI = '0x2::sui::SUI'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const HBTC = '0xd30fb3f8914efdbeb7b8e85fae1d65dc584b44a1281f66737b92bb9f03a59d06::btc::BTC'
const GAS_BUDGET = 2_000_000_000n

const CASES: [string, string, string, bigint][] = [
  ['SUI->USDC 20 SUI', SUI, USDC, 20n * 10n ** 9n],
  ['SUI->USDC 3000 SUI', SUI, USDC, 3_000n * 10n ** 9n],
  ['SUI->DEEP 50 SUI', SUI, DEEP, 50n * 10n ** 9n],
  ['SUI->hBTC 500 SUI', SUI, HBTC, 500n * 10n ** 9n],
  ['USDC->SUI 5000 USDC', USDC, SUI, 5_000n * 10n ** 6n],
  ['USDC->hBTC 5000 USDC', USDC, HBTC, 5_000n * 10n ** 6n],
  ['DEEP->SUI 20000 DEEP', DEEP, SUI, 20_000n * 10n ** 6n],
  ['DEEP->USDC 20000 DEEP', DEEP, USDC, 20_000n * 10n ** 6n]
]

const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

async function quote(from: string, target: string, amount: bigint) {
  const qs = new URLSearchParams({
    from,
    target,
    amount: amount.toString(),
    by_amount_in: 'true',
    depth: '3',
    version: '18',
    providers: 'deepbook'
  })
  const res = await fetch(`${AG_API}/find_routes?${qs}`, {
    headers: { referer: 'https://app.naviprotocol.io/', 'user-agent': 'navi-ag-e2e/1.0' }
  })
  const body: any = await res.json().catch(() => ({}))
  return { status: res.status, data: body?.data ?? body }
}

function inputCoin(tx: Transaction, from: string, amount: bigint) {
  return norm(from) === norm(SUI)
    ? tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
    : tx.add(coinWithBalance({ type: from, balance: amount }))
}

/** 参考：每跳 v9 直接 swap + 0 DEEP（不经过 SDK），dev-inspect 语义读最终输出 */
function buildReference(tx: Transaction, data: any) {
  const routes: any[] = data.routes
  const total = routes.reduce((s, r) => s + BigInt(Math.floor(Number(r.amount_in))), 0n)
  const coinIn = inputCoin(tx, data.from, total)
  const parts = tx.splitCoins(
    coinIn,
    routes.map((r) => tx.pure.u64(Math.floor(Number(r.amount_in))))
  )
  // 先拼完所有路由，最后统一读值：多路由时读值命令才是最后 n 条
  const finals: any[] = []
  routes.forEach((route, i) => {
    let coin: any = parts[i]
    for (const hop of route.path) {
      const types: string[] = hop.info_for_ptb.typeArguments
      const zeroDeep = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEP] })
      const out = tx.moveCall({
        target: `${V9}::pool::${hop.a2b ? 'swap_exact_base_for_quote' : 'swap_exact_quote_for_base'}`,
        typeArguments: types,
        arguments: [tx.object(hop.id), coin, zeroDeep, tx.pure.u64(0), tx.object.clock()]
      })
      coin = hop.a2b ? out[1] : out[0]
    }
    finals.push(coin)
  })
  for (const coin of finals)
    tx.moveCall({ target: '0x2::coin::value', typeArguments: [data.target], arguments: [coin] })
  return routes.length
}

function poolVersions(effects: any, ids: string[]) {
  const out: Record<string, string> = {}
  for (const o of [
    ...(effects?.changedObjects ?? []),
    ...(effects?.unchangedConsensusObjects ?? [])
  ]) {
    if (ids.includes(o.objectId)) out[o.objectId] = String(o.inputVersion ?? o.version)
  }
  return out
}

;(async () => {
  const rows: any[] = []
  let failed = 0
  console.log(`sender: ${SENDER} receiver: ${RECEIVER}`)
  for (const [name, from, target, amount] of CASES) {
    const q = await quote(from, target, amount)
    if (q.status !== 200 || !q.data?.routes?.length) {
      rows.push({
        case: name,
        result: 'no_route',
        status: q.status,
        body: JSON.stringify(q.data).slice(0, 160)
      })
      console.log(`SKIP ${name}: ${q.status} ${JSON.stringify(q.data).slice(0, 120)}`)
      continue
    }
    const data = { ...q.data, is_accurate: false }
    const pools: string[] = [
      ...new Set<string>(data.routes.flatMap((r: any) => r.path.map((h: any) => h.id)))
    ]

    const tx = new Transaction()
    tx.setSender(SENDER)
    tx.setGasBudget(GAS_BUDGET)
    const coinIn = inputCoin(tx, from, BigInt(Math.floor(Number(data.amount_in))))
    const out = await buildSwapWithoutServiceFee(SENDER, tx, coinIn as any, data, 0, 0, false)
    tx.transferObjects([out as any], RECEIVER)

    const ref = new Transaction()
    ref.setSender(SENDER)
    const n = buildReference(ref, data)

    const [sdkSim, refSim]: any[] = await Promise.all([
      client.core.simulateTransaction({
        transaction: tx,
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
      case: name,
      routes: data.routes.length,
      hops: data.routes.flatMap((x: any) => x.path).length,
      quoteOut: String(data.amount_out)
    }
    row.sdkOk = Boolean(s?.status?.success)
    if (!row.sdkOk) row.sdkError = JSON.stringify(s?.status?.error ?? sdkSim).slice(0, 300)
    row.touchesDeepPool = JSON.stringify(s?.effects ?? {}).includes(
      AggregatorConfig.deepSponsoredPoolConfig.slice(2)
    )
    const received = (sdkSim.balanceChanges ?? s?.balanceChanges ?? [])
      .filter((c: any) => norm(c.coinType) === norm(target) && c.address === RECEIVER)
      .reduce((t: bigint, c: any) => t + BigInt(c.amount), 0n)
    row.received = received.toString()
    if (r?.status?.success) {
      // coinWithBalance 会在末尾追加不返回值的收尾命令：跳过它们，读值命令是再往前的 n 条
      let L = refSim.commandResults.length
      while (L > 0 && (refSim.commandResults[L - 1].returnValues ?? []).length === 0) L--
      let refOut = 0n
      for (let i = L - n; i < L; i++)
        refOut += Buffer.from(refSim.commandResults[i].returnValues[0].bcs).readBigUInt64LE(0)
      row.referenceOut = refOut.toString()
    } else row.referenceError = JSON.stringify(r?.status?.error).slice(0, 200)
    const vs = poolVersions(s?.effects, pools)
    const vr = poolVersions(r?.effects, pools)
    row.sameState = pools.every((p) => vs[p] !== undefined && vs[p] === vr[p])
    const equal = row.referenceOut !== undefined && row.received === row.referenceOut
    row.result =
      !row.sdkOk || row.touchesDeepPool
        ? 'fail'
        : !row.sameState
          ? 'pass_state_moved'
          : equal
            ? 'pass'
            : 'fail'
    if (row.result === 'fail') failed++
    rows.push(row)
    console.log(
      `${row.result.toUpperCase().padEnd(16)} ${name.padEnd(22)} routes=${row.routes} hops=${row.hops} sdkOk=${row.sdkOk} received=${row.received} reference=${row.referenceOut ?? row.referenceError} deepPool=${row.touchesDeepPool}` +
        (row.sdkError ? ` err=${row.sdkError.slice(0, 160)}` : '')
    )
  }
  const judged = rows.filter((x) => x.result === 'pass' || x.result === 'fail').length
  if (judged === 0) failed++
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = new URL('./reports/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    new URL(`deepbook-input-fee-${ts}.json`, dir),
    JSON.stringify({ agApi: AG_API, sender: SENDER, receiver: RECEIVER, time: ts, rows }, null, 1)
  )
  console.log(
    `report: tests/e2e/reports/deepbook-input-fee-${ts}.json failed=${failed} judged=${judged}`
  )
  process.exit(failed ? 1 : 0)
})()
