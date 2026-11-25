/**
 * E2E（tests/e2e/aftermath-v5-failure-modes.md S1–S5）：SDK 拼的 Aftermath 交易（amm v5 swap_exact_in）在主网可执行，
 * 且收到的币 = 参考调用。主网 simulate，不签名、不广播。
 *
 * 每个用例：
 *   1. 报价：
 *      - 默认（合成路由）：从链上读池子类型拼一条单跳或两跳路由；先 simulate 参考交易拿到精确输出 X，
 *        报价 amount_out = X、每跳 amountLimit = ⌊0.9·该跳输出⌋（与后端 get-ptb-info 相同），minAmountOut = X；
 *      - AG_API=<后端> 时：向后端要 providers=aftermath、version=AG_VERSION 的报价（只读）。
 *   2. 用本 SDK 的 buildSwapWithoutServiceFee 拼整笔交易，输出转给单独的收款地址；用真实地址、打开检查 simulate。
 *   3. 参考交易：同一路由，每跳直接调 v5 `swap::swap_exact_in_direct`（min_out = 0），dev-inspect 读输出。
 * 判据：SDK 交易成功；两笔读到的 Aftermath 池子版本相同时，收款地址收到的币 = 参考输出（合成模式下即 = 报价）。
 * 后端模式下另记到账与报价 amount_out 的差（报价与 simulate 之间池子可能变化）。
 *
 * 用法（在 packages/astros-aggregator-sdk 下）：npx tsx tests/e2e/aftermath-v5.ts
 *   AG_API / AG_VERSION 见上；SENDER 覆盖发送方（默认同时持有 SUI / USDC 的地址）；SUI_GRPC_URL 覆盖节点
 * 产物：tests/e2e/reports/aftermath-v5-<时间>.json；有失败时退出码 1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig } from '../../src/libs/Aggregator/config'

const AG_API = process.env.AG_API || ''
const AG_VERSION = process.env.AG_VERSION || '20'
const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const SENDER =
  process.env.SENDER || '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
const MAX_ATTEMPTS = 5
const RECEIVER = '0x000000000000000000000000000000000000000000000000000000000000beef'
const V5 = '0x93056cd889839d7186498c5e86d3087cb79dacb08ae0e18b9b2c42ebe06d7be7'
const GAS_BUDGET = 2_000_000_000n

const SUI = '0x2::sui::SUI'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const AFSUI = '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI'
const HASUI = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI'
const NS = '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS'

/** Aftermath 池子（主网）：SUI/afSUI 加权、SUI/USDC 加权、8 币 LST 加权、3 币稳定 */
const POOL_SUI_AFSUI = '0x97aae7a80abb29c9feabbe7075028550230401ffe7fb745757d3c28a30437408'
const POOL_SUI_USDC = '0xb0cc4ce941a6c6ac0ca6d8e6875ae5d86edbec392c3333d008ca88f377e5e181'
const POOL_LST8 = '0x52ac89ee8c446638930f53129803f026a04028d2c0deef314321f71c69ab7f78'
const POOL_STABLE3 = '0x9f1d4fcb702b0febc15c463bde51cd1176194c712696e7f4e7228574e8551d83'

type Hop = { pool: string; from: string; target: string }
/** 合成路由用例：[名称, 输入币, 金额, 跳] */
const SYNTHETIC: [string, string, bigint, Hop[]][] = [
  ['SUI->afSUI 10 SUI', SUI, 10n * 10n ** 9n, [{ pool: POOL_SUI_AFSUI, from: SUI, target: AFSUI }]],
  ['SUI->USDC 100 SUI', SUI, 100n * 10n ** 9n, [{ pool: POOL_SUI_USDC, from: SUI, target: USDC }]],
  ['USDC->SUI 50 USDC', USDC, 50n * 10n ** 6n, [{ pool: POOL_SUI_USDC, from: USDC, target: SUI }]],
  ['SUI->haSUI 8-coin', SUI, 5n * 10n ** 9n, [{ pool: POOL_LST8, from: SUI, target: HASUI }]],
  ['SUI->USDC stable 3-coin', SUI, 10n ** 7n, [{ pool: POOL_STABLE3, from: SUI, target: USDC }]],
  [
    'SUI->afSUI->SUI 2 hops',
    SUI,
    20n * 10n ** 9n,
    [
      { pool: POOL_SUI_AFSUI, from: SUI, target: AFSUI },
      { pool: POOL_LST8, from: AFSUI, target: SUI }
    ]
  ]
]
/** 后端模式用例：[名称, from, target, 金额] */
const BACKEND: [string, string, string, bigint][] = [
  ['SUI->USDC 100 SUI', SUI, USDC, 100n * 10n ** 9n],
  ['SUI->afSUI 50 SUI', SUI, AFSUI, 50n * 10n ** 9n],
  ['SUI->NS 100 SUI', SUI, NS, 100n * 10n ** 9n],
  ['USDC->SUI 100 USDC', USDC, SUI, 100n * 10n ** 6n]
]

const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

async function backendQuote(from: string, target: string, amount: bigint) {
  const qs = new URLSearchParams({
    from,
    target,
    amount: amount.toString(),
    by_amount_in: 'true',
    depth: '3',
    version: AG_VERSION,
    providers: 'aftermath'
  })
  const res = await fetch(`${AG_API}/find_routes?${qs}`, {
    headers: { referer: 'https://app.naviprotocol.io/', 'user-agent': 'navi-ag-e2e/1.0' }
  })
  const body: any = await res.json().catch(() => ({}))
  return { status: res.status, data: body?.data ?? body }
}

/** 池子类型 `<pkg>::pool::Pool<LP>` 里的 LP 类型 */
async function lpType(pool: string): Promise<string> {
  const res: any = await client.core.getObject({ objectId: pool })
  const type: string = res.object.type
  const m = type.match(/::pool::Pool<(.+)>$/)
  if (!m) throw new Error(`not an Aftermath pool: ${pool} ${type}`)
  return m[1]
}

function inputCoin(tx: Transaction, from: string, amount: bigint) {
  return norm(from) === norm(SUI)
    ? tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
    : tx.add(coinWithBalance({ type: from, balance: amount }))
}

/** 参考：每跳直接调 v5 swap_exact_in_direct（min_out 0）；每跳输出从 SwapEvent 读（事件顺序 = 跳的顺序），只转出每条路由的最终币 */
function buildReference(tx: Transaction, data: any) {
  const routes: any[] = data.routes
  const total = routes.reduce((s, r) => s + BigInt(Math.floor(Number(r.amount_in))), 0n)
  const coinIn = inputCoin(tx, data.from, total)
  const parts = tx.splitCoins(
    coinIn,
    routes.map((r) => tx.pure.u64(Math.floor(Number(r.amount_in))))
  )
  const finals: any[] = []
  routes.forEach((route, i) => {
    let coin: any = parts[i]
    for (const hop of route.path) {
      const [lp, cin, cout] = hop.info_for_ptb.typeArguments
      coin = tx.moveCall({
        target: `${V5}::swap::swap_exact_in_direct`,
        typeArguments: [lp, cin, cout],
        arguments: [
          tx.object(hop.id),
          tx.object(AggregatorConfig.aftermathPoolRegistry),
          tx.object(AggregatorConfig.aftermathFeeVault),
          tx.object(AggregatorConfig.aftermathTreasury),
          tx.object(AggregatorConfig.aftermathInsuranceFund),
          tx.object(AggregatorConfig.aftermathReferralVault),
          coin,
          tx.pure.u64(0)
        ]
      })
    }
    finals.push(coin)
  })
  tx.transferObjects(finals, RECEIVER)
  // 非 SUI 输入：切完剩下的币（0 面值也不能丢弃）转回发送方
  if (norm(data.from) !== norm(SUI)) tx.transferObjects([coinIn as any], SENDER)
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

async function simulateRef(data: any) {
  const ref = new Transaction()
  ref.setSender(SENDER)
  ref.setGasBudget(GAS_BUDGET)
  buildReference(ref, data)
  const hops = data.routes.reduce((n: number, r: any) => n + r.path.length, 0)
  const sim: any = await client.core.simulateTransaction({
    transaction: ref,
    checksEnabled: false,
    include: { effects: true, events: true }
  } as any)
  const r = sim.Transaction ?? sim.FailedTransaction
  if (!r?.status?.success)
    return { ok: false as const, error: JSON.stringify(r?.status?.error).slice(0, 300) }
  const events = (r.events ?? sim.events ?? []).filter((e: any) =>
    /::events::SwapEvent/.test(e.eventType ?? '')
  )
  if (events.length !== hops)
    return { ok: false as const, error: `expected ${hops} swap events, got ${events.length}` }
  const values = events.map((e: any) => BigInt(e.json.amounts_out[0]))
  return { ok: true as const, values, effects: r.effects }
}

/** 合成路由：先 simulate 参考交易拿到每跳精确输出，再填成后端格式的报价 */
async function syntheticQuote(from: string, amount: bigint, hops: Hop[]) {
  const types = await Promise.all(hops.map((h) => lpType(h.pool)))
  const path = hops.map((h, i) => ({
    id: h.pool,
    provider: 'aftermath',
    from: h.from,
    target: h.target,
    a2b: true,
    info_for_ptb: {
      typeArguments: [`0x${types[i].replace(/^0x/, '')}`, h.from, h.target],
      amountLimit: 0
    }
  }))
  const target = hops[hops.length - 1].target
  const draft: any = {
    from,
    target,
    amount_in: amount.toString(),
    amount_out: '0',
    routes: [{ path, amount_in: amount.toString(), amount_out: '0' }]
  }
  const ref = await simulateRef(draft)
  if (!ref.ok) throw new Error(`reference failed: ${ref.error}`)
  // 与后端 get-ptb-info 相同：amountLimit = ⌊该跳输出 × 0.9⌋
  path.forEach((p, i) => (p.info_for_ptb.amountLimit = Number((ref.values[i] * 9n) / 10n)))
  const out = ref.values[ref.values.length - 1].toString()
  draft.amount_out = out
  draft.routes[0].amount_out = out
  return draft
}

;(async () => {
  const rows: any[] = []
  let failed = 0
  const mode = AG_API ? `backend ${new URL(AG_API).host} version=${AG_VERSION}` : 'synthetic'
  console.log(
    `mode: ${mode} sender: ${SENDER} receiver: ${RECEIVER} aftermathPackageId: ${AggregatorConfig.aftermathPackageId}`
  )
  const cases: { name: string; from: string; target: string; get: () => Promise<any> }[] = AG_API
    ? BACKEND.map(([name, from, target, amount]) => ({
        name,
        from,
        target,
        get: async () => {
          const q = await backendQuote(from, target, amount)
          if (q.status !== 200 || !q.data?.routes?.length)
            return { skip: `${q.status} ${JSON.stringify(q.data).slice(0, 160)}` }
          return { data: { ...q.data, is_accurate: false } }
        }
      }))
    : SYNTHETIC.map(([name, from, amount, hops]) => ({
        name,
        from,
        target: hops[hops.length - 1].target,
        get: async () => ({ data: await syntheticQuote(from, amount, hops) })
      }))

  for (const c of cases) {
    // Pool state can move between the two simulations; re-quote and retry so 'received = reference'
    // is really checked. A row still in a moved state after MAX_ATTEMPTS fails.
    let row: any
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let got: any
      try {
        got = await c.get()
      } catch (error: any) {
        got = { error: String(error?.message ?? error).slice(0, 300) }
      }
      if (!got.data) {
        row = {
          case: c.name,
          result: got.skip ? 'no_route' : 'fail',
          detail: got.skip ?? got.error
        }
        break
      }
      const data = got.data
      const hops: any[] = data.routes.flatMap((r: any) => r.path)
      const nonAftermath = hops.filter((h) => h.provider !== 'aftermath').length
      const pools: string[] = [...new Set<string>(hops.map((h) => h.id))]
      const quoteOut = BigInt(Math.floor(Number(data.amount_out)))

      const tx = new Transaction()
      tx.setSender(SENDER)
      tx.setGasBudget(GAS_BUDGET)
      const coinIn = inputCoin(tx, data.from, BigInt(Math.floor(Number(data.amount_in))))
      // 合成模式 minAmountOut = 报价（S4：min_out 不会误伤，最后的滑点检查按报价通过）；后端模式 0
      const minOut = AG_API ? 0 : Number(quoteOut)
      const out = await buildSwapWithoutServiceFee(
        SENDER,
        tx,
        coinIn as any,
        data,
        minOut,
        0,
        false
      )
      tx.transferObjects([out as any], RECEIVER)

      const [sdkSim, ref]: any[] = await Promise.all([
        client.core.simulateTransaction({
          transaction: tx,
          include: { effects: true, balanceChanges: true }
        } as any),
        simulateRef(data)
      ])
      const s = sdkSim.Transaction ?? sdkSim.FailedTransaction
      row = {
        case: c.name,
        routes: data.routes.length,
        hops: hops.length,
        nonAftermath,
        quoteOut: quoteOut.toString()
      }
      row.sdkOk = Boolean(s?.status?.success)
      if (!row.sdkOk) row.sdkError = JSON.stringify(s?.status?.error ?? sdkSim).slice(0, 300)
      // SDK 交易里所有 Aftermath swap_exact_in 调用的包（S1–S3：必须全是 v5）
      row.calledPackages = [
        ...new Set(
          tx
            .getData()
            .commands.filter(
              (x: any) => x.MoveCall?.module === 'swap' && x.MoveCall?.function === 'swap_exact_in'
            )
            .map((x: any) => x.MoveCall.package)
        )
      ]
      const received = (sdkSim.balanceChanges ?? s?.balanceChanges ?? [])
        .filter((x: any) => norm(x.coinType) === norm(c.target) && x.address === RECEIVER)
        .reduce((t: bigint, x: any) => t + BigInt(x.amount), 0n)
      row.received = received.toString()
      row.receivedMinusQuote = (received - quoteOut).toString()
      if (ref.ok) {
        // 每条路由最后一跳的输出之和
        let k = 0
        let refOut = 0n
        for (const r of data.routes) {
          k += r.path.length
          refOut += ref.values[k - 1]
        }
        row.referenceOut = refOut.toString()
      } else row.referenceError = ref.error
      const vs = poolVersions(s?.effects, pools)
      const vr = ref.ok ? poolVersions(ref.effects, pools) : {}
      row.sameState = pools.every((p) => vs[p] !== undefined && vs[p] === vr[p])
      const usesV5 =
        row.calledPackages.length > 0 && row.calledPackages.every((x: string) => x === V5)
      const equal = row.referenceOut !== undefined && row.received === row.referenceOut
      row.result =
        !row.sdkOk || !usesV5 || nonAftermath > 0
          ? 'fail'
          : !row.sameState
            ? 'state_moved'
            : equal
              ? 'pass'
              : 'fail'
      row.attempts = attempt
      if (row.result !== 'state_moved') break
    }
    if (row.result === 'state_moved') row.result = 'fail_state_moved'
    if (row.result !== 'pass' && row.result !== 'no_route') failed++
    if (row.detail !== undefined) {
      rows.push(row)
      console.log(`${row.result.toUpperCase().padEnd(16)} ${c.name}: ${row.detail}`)
      continue
    }
    rows.push(row)
    console.log(
      `${row.result.toUpperCase().padEnd(16)} ${c.name.padEnd(24)} hops=${row.hops} sdkOk=${row.sdkOk} quote=${row.quoteOut} received=${row.received} reference=${row.referenceOut ?? row.referenceError}` +
        (row.sdkError ? ` err=${row.sdkError.slice(0, 160)}` : '')
    )
  }
  mkdirSync('tests/e2e/reports', { recursive: true })
  const file = `tests/e2e/reports/aftermath-v5-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(
    file,
    JSON.stringify(
      {
        mode,
        grpc: new URL(GRPC).host,
        sender: SENDER,
        aftermathPackageId: AggregatorConfig.aftermathPackageId,
        failed,
        rows
      },
      null,
      2
    )
  )
  console.log(`report: ${file}; failed ${failed}`)
  process.exit(failed ? 1 : 0)
})()
