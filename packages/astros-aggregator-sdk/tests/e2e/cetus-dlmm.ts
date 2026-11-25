/**
 * E2E：SDK 拼的 Cetus DLMM 交易在主网可执行，且到账 = 后端本地报价。
 *
 * 每个用例：
 *   1. gRPC 读 SUI/USDC 主池的完整原始状态（池子 + 全部 bin 分组 + Versioned），前后版本相同才用。
 *   2. 构造一份 provider=cetusDlmm 的报价（一条或两条路径，都走这个池子），用本 SDK 的 buildSwapWithoutServiceFee 拼整笔交易；
 *      第 0 条命令读 Clock（动态费率按 Clock 秒数算），输出转给单独的收款地址。
 *      用持币的真实地址、打开检查在主网 simulate（不签名、不广播）：打开检查才能发现没消费的返回值（hot potato / 零余额）。
 *   3. 第二次 simulate 把 minAmountOut 设成第一次的到账（滑点检查卡死），必须仍然成功。
 * 产物：tests/e2e/reports/cetus-dlmm-<时间>.json（simulate 读到的池子版本、Clock、到账）+ 同名 .raw.json（池子原始状态，不进仓库）。
 * 后端用同一份原始状态 + Clock 按本地算价器（applyExactIn 依次成交）算报价并逐整数比较：
 *   dex-aggregator-backend: npx tsx tests/e2e/cetusDlmm/sdk-check.ts <本报告路径> <.raw.json 路径>
 *
 * 用法（在 packages/astros-aggregator-sdk 下）：npx tsx tests/e2e/cetus-dlmm.ts
 *   SENDER 覆盖发送方（默认 deepbook-input-fee.ts 用的地址，同时持有 SUI / USDC）；SUI_GRPC_URL 覆盖节点
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig } from '../../src/libs/Aggregator/config'

const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const SENDER =
  process.env.SENDER || '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
const RECEIVER = '0x000000000000000000000000000000000000000000000000000000000000beef'
const POOL = '0x64e590b0e4d4f7dfc7ae9fae8e9983cd80ad83b658d8499bf550a9d4f6667076'
const SUI = '0x2::sui::SUI'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const GAS_BUDGET = 2_000_000_000n

// [名称, from, target, 各路径金额]
const CASES: [string, string, string, bigint[]][] = [
  ['SUI->USDC 5 SUI', SUI, USDC, [5n * 10n ** 9n]],
  ['SUI->USDC 3000 SUI', SUI, USDC, [3_000n * 10n ** 9n]],
  ['USDC->SUI 50 USDC', USDC, SUI, [50n * 10n ** 6n]],
  ['USDC->SUI 20000 USDC', USDC, SUI, [20_000n * 10n ** 6n]],
  ['SUI->USDC 2 paths 300+700 SUI', SUI, USDC, [300n * 10n ** 9n, 700n * 10n ** 9n]]
]

const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

async function getJson(id: string) {
  const res: any = await client.core.getObject({ objectId: id, include: { json: true } })
  return {
    version: String(res.object.version),
    type: String(res.object.type),
    json: res.object.json
  }
}

/** 池子完整原始状态：分组是跳表 bin_manager.bins 下的动态字段 */
async function rawPoolState() {
  const before = await getJson(POOL)
  const parent = before.json.bin_manager.bins.id
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page: any = await client.core.listDynamicFields({
      parentId: parent,
      ...(cursor ? { cursor } : {})
    } as any)
    for (const f of page.dynamicFields) ids.push(f.fieldId)
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  const groups: any[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const res: any = await client.core.getObjects({
      objectIds: ids.slice(i, i + 50),
      include: { json: true }
    })
    for (const o of res.objects) {
      if (o instanceof Error) throw o
      groups.push(o.json.value)
    }
  }
  const versioned = await getJson(AggregatorConfig.cetusDlmmVersioned)
  const after = await getJson(POOL)
  if (after.version !== before.version) return null
  return {
    version: before.version,
    type: before.type,
    poolJson: before.json,
    groups,
    versioned: versioned.json.version
  }
}

function quoteFor(type: string, from: string, target: string, amounts: bigint[]) {
  const a2b = norm(type.slice(type.indexOf('<') + 1).split(',')[0]) === norm(from)
  const typeArguments = type
    .slice(type.indexOf('<') + 1, type.lastIndexOf('>'))
    .split(',')
    .map((s) => s.trim())
  const total = amounts.reduce((s, x) => s + x, 0n)
  return {
    from,
    target,
    amount_in: total.toString(),
    amount_out: '0',
    is_accurate: false,
    routes: amounts.map((amount) => ({
      amount_in: amount.toString(),
      amount_out: '0',
      path: [
        {
          id: POOL,
          provider: 'cetusDlmm',
          from,
          target,
          a2b,
          type,
          fee_rate: 0,
          amount_in: amount.toString(),
          amount_out: '0',
          info_for_ptb: {
            packageId: AggregatorConfig.cetusDlmmPublishedAt,
            moduleName: 'pool',
            functionName: 'flash_swap',
            typeArguments
          }
        }
      ]
    })),
    dexList: []
  } as any
}

async function simulate(from: string, target: string, quote: any, minOut: number) {
  const tx = new Transaction()
  tx.setSender(SENDER)
  tx.setGasBudget(GAS_BUDGET)
  tx.moveCall({ target: '0x2::clock::timestamp_ms', arguments: [tx.object.clock()] })
  const total = BigInt(quote.amount_in)
  const coinIn =
    norm(from) === norm(SUI)
      ? tx.splitCoins(tx.gas, [tx.pure.u64(total)])
      : tx.add(coinWithBalance({ type: from, balance: total }))
  const out = await buildSwapWithoutServiceFee(SENDER, tx, coinIn as any, quote, minOut, 0, false)
  tx.transferObjects([out as any], RECEIVER)
  const sim: any = await client.core.simulateTransaction({
    transaction: tx,
    include: { effects: true, balanceChanges: true, events: true, commandResults: true }
  } as any)
  const s = sim.Transaction ?? sim.FailedTransaction
  const ok = Boolean(s?.status?.success)
  const pool = [
    ...(s?.effects?.changedObjects ?? []),
    ...(s?.effects?.unchangedConsensusObjects ?? [])
  ].find((o: any) => o.objectId === POOL)
  const received = (sim.balanceChanges ?? s?.balanceChanges ?? [])
    .filter((c: any) => norm(c.coinType) === norm(target) && c.address === RECEIVER)
    .reduce((t: bigint, c: any) => t + BigInt(c.amount), 0n)
  const swapEvents = (s?.events ?? []).filter((e: any) =>
    String(e.eventType ?? e.type ?? '').endsWith('::pool::SwapEvent')
  )
  return {
    ok,
    error: ok ? null : JSON.stringify(s?.status?.error ?? sim).slice(0, 400),
    poolVersion: pool ? String(pool.inputVersion ?? pool.version) : null,
    nowMs: ok ? String(bcs.u64().parse(sim.commandResults[0].returnValues[0].bcs)) : null,
    received: received.toString(),
    swapEvents: swapEvents.map((e: any) => ({
      partner: e.json.partner,
      ref_fee: e.json.ref_fee,
      amount_in: e.json.amount_in,
      amount_out: e.json.amount_out
    }))
  }
}

;(async () => {
  const rows: any[] = []
  let failed = 0
  console.log(
    `sender: ${SENDER} receiver: ${RECEIVER} package: ${AggregatorConfig.cetusDlmmPublishedAt}`
  )
  for (const [name, from, target, amounts] of CASES) {
    let row: any = null
    let lastReason = 'state_kept_moving'
    for (let attempt = 1; attempt <= 5 && !row; attempt++) {
      const raw = await rawPoolState()
      if (!raw) {
        lastReason = 'pool_state_unavailable'
        continue
      }
      const quote = quoteFor(raw.type, from, target, amounts)
      const first = await simulate(from, target, quote, 0)
      // 池子在读状态后变了，重来。SDK 模拟失败时 effects 里可能没有池子，不能当成"状态变了"，直接记录真实错误
      if (first.ok && first.poolVersion !== raw.version) {
        lastReason = 'state_kept_moving'
        continue
      }
      const tight = first.ok ? await simulate(from, target, quote, Number(first.received)) : null
      row = {
        case: name,
        from,
        target,
        a2b: quote.routes[0].path[0].a2b,
        pathAmounts: amounts.map(String),
        sdkOk: first.ok,
        sdkError: first.error,
        poolVersion: first.poolVersion,
        nowMs: first.nowMs,
        received: first.received,
        swapEvents: first.swapEvents,
        tightSlippageOk: tight?.ok ?? false,
        tightSameState: tight ? tight.poolVersion === first.poolVersion : false,
        tightReceived: tight?.received,
        raw
      }
    }
    if (!row) {
      rows.push({ case: name, result: lastReason })
      console.log(`${lastReason.toUpperCase()} ${name}`)
      failed++
      continue
    }
    // 判据：成交成功；没有 partner（0x0、ref_fee 0）；卡死滑点（同一池子版本时）仍成功；到账 > 0
    const noPartner =
      row.swapEvents.length === amounts.length &&
      row.swapEvents.every((e: any) => /^0x0+$/.test(e.partner) && e.ref_fee === '0')
    row.result =
      row.sdkOk &&
      noPartner &&
      BigInt(row.received) > 0n &&
      (row.tightSlippageOk || !row.tightSameState)
        ? 'pass'
        : 'fail'
    if (row.result === 'fail') failed++
    rows.push(row)
    console.log(
      `${row.result.toUpperCase().padEnd(6)} ${name.padEnd(30)} sdkOk=${row.sdkOk} received=${row.received} tight=${row.tightSlippageOk} pool@${row.poolVersion} clock=${row.nowMs}` +
        (row.sdkError ? ` err=${row.sdkError.slice(0, 200)}` : '')
    )
  }
  mkdirSync('tests/e2e/reports', { recursive: true })
  const file = `tests/e2e/reports/cetus-dlmm-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  // 池子原始状态单独存一个文件（几百 KB，不进仓库），报告里只留摘要
  const rawFile = file.replace(/\.json$/, '.raw.json')
  writeFileSync(rawFile, JSON.stringify(rows.map((r) => ({ case: r.case, raw: r.raw ?? null }))))
  const summary = rows.map(({ raw, ...r }) => ({
    ...r,
    rawPoolVersion: raw?.version,
    rawGroups: raw?.groups?.length
  }))
  writeFileSync(
    file,
    JSON.stringify(
      {
        sender: SENDER,
        receiver: RECEIVER,
        package: AggregatorConfig.cetusDlmmPublishedAt,
        failed,
        rawFile,
        rows: summary
      },
      null,
      2
    )
  )
  console.log(`${rows.length - failed}/${rows.length} pass; report ${file}; raw ${rawFile}`)
  process.exit(failed ? 1 : 0)
})()
