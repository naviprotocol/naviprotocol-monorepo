/**
 * E2E（tests/e2e/deepbook-input-fee-failure-modes.md S1 / S2 / S6）：SDK 拼的 DeepBook 交易在主网可执行，且收到的币 = 参考调用。
 *
 * 每个用例：
 *   1. 向后端要 version 18、providers=deepbook 的报价（只读）。
 *   2. 用本 SDK 的 buildSwapWithoutServiceFee 拼整笔交易（输入币从 gas 切），输出转给发送方；
 *      用持有 SUI 的真实地址、打开检查在主网 simulate（不签名、不广播）。打开检查才能发现没消费的返回值（S2）。
 *   3. 同时 simulate 参考交易：同一路由，每跳直接调 v9 `pool::swap_exact_*`、DEEP 传 0（后端 input_fee 报价已对拍过的调用）。
 * 判据：SDK 交易成功；没有触碰赞助池 DeepPool；两笔读到的 DeepBook 池子版本相同时，发送方收到的目标币 = 参考输出。
 * 报价副本的 is_accurate 置为 false：正向滑点只在 is_accurate=true 时开启，关掉才能逐整数比较。
 *
 * 用法（在 packages/astros-aggregator-sdk 下）：npx tsx tests/e2e/deepbook-input-fee.ts
 *   AG_API 覆盖后端（默认生产开放 API），SENDER 指定持币地址（默认自动找一个 SUI 足够的地址），SUI_GRPC_URL 覆盖节点
 * 产物：tests/e2e/reports/deepbook-input-fee-<时间>.json；有失败时退出码 1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig } from '../../src/libs/Aggregator/config'

const AG_API = process.env.AG_API || 'https://open-aggregator-api.naviprotocol.io'
const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const GRAPHQL = 'https://graphql.mainnet.sui.io/graphql'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const V9 = '0xbca0cefe720330e7bb4f2283438b68de6a0e656688db4ac90d61e71fe6151fe8'
const DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
const SUI = '0x2::sui::SUI'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const HBTC = '0xd30fb3f8914efdbeb7b8e85fae1d65dc584b44a1281f66737b92bb9f03a59d06::btc::BTC'
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'
const GAS_BUDGET = 2_000_000_000n

const CASES: [string, string, bigint][] = [
  ['SUI->USDC 20 SUI', USDC, 20n * 10n ** 9n],
  ['SUI->USDC 3000 SUI', USDC, 3_000n * 10n ** 9n],
  ['SUI->DEEP 50 SUI', DEEP, 50n * 10n ** 9n],
  ['SUI->hBTC 500 SUI', HBTC, 500n * 10n ** 9n]
]

const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  return (await res.json()) as any
}

/** 翻 Coin<SUI> 对象找一个总余额 ≥ need 的普通地址 */
async function findSender(need: bigint): Promise<string> {
  if (process.env.SENDER) return process.env.SENDER
  let after: string | null = null
  const seen = new Set<string>()
  for (let page = 0; page < 40; page++) {
    const r: any = await gql(
      `query($after: String) { objects(filter: { type: "0x2::coin::Coin<0x2::sui::SUI>" }, first: 50, after: $after) {
        pageInfo { hasNextPage endCursor } nodes { owner { __typename ... on AddressOwner { address { address } } } asMoveObject { contents { json } } } } }`,
      { after }
    )
    const o = r?.data?.objects
    if (!o) break
    for (const n of o.nodes) {
      if (
        n.owner?.__typename !== 'AddressOwner' ||
        BigInt(n.asMoveObject.contents.json.balance) < 10n ** 9n
      )
        continue
      const a = n.owner.address.address
      if (seen.has(a)) continue
      seen.add(a)
      const b: any = await gql(
        `query($a: SuiAddress!) { address(address: $a) { balance(coinType: "0x2::sui::SUI") { totalBalance } } }`,
        { a }
      )
      if (BigInt(b?.data?.address?.balance?.totalBalance ?? 0) >= need) return a
    }
    if (!o.pageInfo.hasNextPage) break
    after = o.pageInfo.endCursor
  }
  throw new Error('no SUI holder found; set SENDER')
}

async function quote(target: string, amount: bigint) {
  const qs = new URLSearchParams({
    from: SUI,
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

/** 参考：每跳 v9 直接 swap + 0 DEEP（不经过 SDK），dev-inspect 语义读最终输出 */
function buildReference(tx: Transaction, data: any) {
  const routes: any[] = data.routes
  const coinIn = tx.splitCoins(tx.gas, [
    tx.pure.u64(routes.reduce((s, r) => s + BigInt(Math.floor(Number(r.amount_in))), 0n))
  ])
  const parts = tx.splitCoins(
    coinIn,
    routes.map((r) => tx.pure.u64(Math.floor(Number(r.amount_in))))
  )
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
    tx.moveCall({ target: '0x2::coin::value', typeArguments: [data.target], arguments: [coin] })
  })
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
  const sender = await findSender(3_100n * 10n ** 9n + GAS_BUDGET)
  console.log(`sender: ${sender}`)
  for (const [name, target, amount] of CASES) {
    const q = await quote(target, amount)
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
    tx.setSender(sender)
    tx.setGasBudget(GAS_BUDGET)
    const coinIn = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(Math.floor(Number(data.amount_in))))])
    const out = await buildSwapWithoutServiceFee(sender, tx, coinIn as any, data, 0, 0, false)
    tx.transferObjects([out as any], sender)

    const ref = new Transaction()
    ref.setSender(ZERO)
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
      .filter((c: any) => norm(c.coinType) === norm(target) && c.address === sender)
      .reduce((t: bigint, c: any) => t + BigInt(c.amount), 0n)
    row.received = received.toString()
    if (r?.status?.success) {
      const L = refSim.commandResults.length
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
      `${row.result.toUpperCase().padEnd(16)} ${name.padEnd(20)} routes=${row.routes} hops=${row.hops} sdkOk=${row.sdkOk} received=${row.received} reference=${row.referenceOut ?? row.referenceError} deepPool=${row.touchesDeepPool}` +
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
    JSON.stringify({ agApi: AG_API, sender, time: ts, rows }, null, 1)
  )
  console.log(
    `report: tests/e2e/reports/deepbook-input-fee-${ts}.json failed=${failed} judged=${judged}`
  )
  process.exit(failed ? 1 : 0)
})()
