/**
 * FlowX AMM（Dex.FLOWX_AMM）SDK E2E：SDK 拼的交易与"直接调协议入口 router::swap_exact_input_direct"的参考交易
 * 在同一状态下 simulate，用户实际到账必须逐整数相等（证明 moveCall 目标、类型参数顺序、Container id 都对）。
 * 只读模拟，不签名不上链。后端算价器与链上逐整数一致的证明在 dex-aggregator-backend 的 tests/e2e/flowxAmm/。
 *
 * 用例（手工构造的单路由；amount_out 填 0 只影响滑点检查的期望值，这里 minAmountOut = 0）：
 *   SUI→IKA            单跳（a2b：SUI 是 pair 的 X）
 *   SUI→IKA→SUI        同一 pair 来回两跳（第二跳 b2a）
 *   SUI→FLX→USDC       两个 pair（FLX/USDC 里 FLX 是 X）
 *   SUI→USDC           单跳大额
 * 状态对齐：两笔 simulate 读到的各 pair Field 对象版本必须相同（Container 版本会被任何 pair 改，不用它）。
 *
 * 用法：npx tsx tests/e2e/flowx-amm.ts   产物：tests/e2e/reports/flowx-amm-<时间>.json；有失败退出码 1。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { buildSwapWithoutServiceFee } from '../../src/libs/Aggregator/buildSwapWithoutServiceFee'
import { AggregatorConfig as C } from '../../src/libs/Aggregator/config'

const GRPC = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io'
const client = new SuiGrpcClient({ baseUrl: GRPC, network: 'mainnet' })
const SENDER =
  process.env.SENDER || '0x60dd01bc037e2c1ea2aaf02187701f9f4453ba323338d2f2f521957065b0984d'
const RECEIVER = '0x000000000000000000000000000000000000000000000000000000000000beef'
const SUI = '0x2::sui::SUI'
const IKA = '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA'
const FLX = '0x6dae8ca14311574fdfe555524ea48558e3d1360d1607d1c7f98af867e3b7976c::flx::FLX'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
/** 各 pair 的 Field 对象（Bag 下的动态字段，状态见证用） */
const FIELDS = [
  '0x56b0fbb25f0780c082daad669ee904129094ce3cdc7f0796894f3d2077387f18', // SUI/IKA
  '0x9ed5b1a7bd56c700ae978f54b5b218ebe545ad39ab51995c9f1a907e9560050c', // SUI/FLX
  '0xdd38b1f85a56bf8d421bf02384f89609435de7ad309f3e998fd199b1217fcad7', // FLX/USDC
  '0x8eba28d4fef9750f52baaaed896d096b0765973ca6c8f193870236b5451a413c' // SUI/USDC
]
const norm = (t: string) => t.replace(/^0x0*([0-9a-f]+)::/i, '0x$1::').toLowerCase()

type Hop = { from: string; target: string; a2b: boolean }
const hop = (h: Hop) => ({
  id: '',
  type: '',
  provider: 'flowxAmm',
  fee_rate: 30,
  amount_in: 0,
  amount_out: 0,
  info_for_ptb: { typeArguments: [] },
  ...h
})

function referenceCall(tx: Transaction, h: Hop, coin: any): any {
  return tx.moveCall({
    target: `${C.flowxAmmPackageId}::router::swap_exact_input_direct`,
    typeArguments: [h.from, h.target],
    arguments: [tx.object(C.flowxAmmContainer), coin]
  })[0]
}

function versions(effects: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of [
    ...(effects?.changedObjects ?? []),
    ...(effects?.unchangedConsensusObjects ?? [])
  ])
    if (FIELDS.includes(o.objectId)) out[o.objectId] = String(o.inputVersion ?? o.version)
  return out
}

;(async () => {
  const cases: { name: string; from: string; target: string; amount: bigint; hops: Hop[] }[] = [
    {
      name: 'SUI->IKA 10 SUI',
      from: SUI,
      target: IKA,
      amount: 10n ** 10n,
      hops: [{ from: SUI, target: IKA, a2b: true }]
    },
    {
      name: 'SUI->IKA->SUI 50 SUI',
      from: SUI,
      target: SUI,
      amount: 5n * 10n ** 10n,
      hops: [
        { from: SUI, target: IKA, a2b: true },
        { from: IKA, target: SUI, a2b: false }
      ]
    },
    {
      name: 'SUI->FLX->USDC 200 SUI',
      from: SUI,
      target: USDC,
      amount: 2n * 10n ** 11n,
      hops: [
        { from: SUI, target: FLX, a2b: true },
        { from: FLX, target: USDC, a2b: true }
      ]
    },
    {
      name: 'SUI->USDC 1000 SUI',
      from: SUI,
      target: USDC,
      amount: 10n ** 12n,
      hops: [{ from: SUI, target: USDC, a2b: true }]
    }
  ]
  const rows: any[] = []
  let failed = 0
  for (const c of cases) {
    const quote: any = {
      from: c.from,
      target: c.target,
      amount_in: c.amount.toString(),
      amount_out: '0',
      is_accurate: false,
      routes: [{ amount_in: Number(c.amount), amount_out: 0, path: c.hops.map(hop) }]
    }
    const tx = new Transaction()
    tx.setSender(SENDER)
    tx.setGasBudget(2_000_000_000n)
    const input = tx.splitCoins(tx.gas, [tx.pure.u64(c.amount)])
    const out = await buildSwapWithoutServiceFee(SENDER, tx, input as any, quote, 0, 0, false)
    tx.transferObjects([out as any], RECEIVER)
    const ref = new Transaction()
    ref.setSender(SENDER)
    let coin: any = ref.splitCoins(ref.gas, [ref.pure.u64(c.amount)])
    for (const h of c.hops) coin = referenceCall(ref, h, coin)
    ref.moveCall({ target: '0x2::coin::value', typeArguments: [c.target], arguments: [coin] })
    ref.transferObjects([coin], RECEIVER)
    const [sdkSim, refSim]: any[] = await Promise.all([
      client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: true,
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
    row.fieldVersions = vs
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
  mkdirSync('tests/e2e/reports', { recursive: true })
  const file = `tests/e2e/reports/flowx-amm-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ sender: SENDER, rows }, null, 1))
  console.log(`${rows.length - failed}/${rows.length} pass -> ${file}`)
  process.exit(failed ? 1 : 0)
})()
