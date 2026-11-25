# Multiply 完整链上快照本地计算：实现与验收

日期：2026-11-24（Asia/Singapore）。仅本地 SDK 改动；未提交、推送、发布或部署，未签名或广播交易。

## 实现范围

- `native-staking.ts`：Volo/Haedal 完整状态读取、BigInt 精确兑换计算、5 秒实例缓存和 epoch 检查。
- `converters.ts`：原生质押提供 `getStakingSnapshot`；保留正式报价和原有执行路径。Haedal 存储中的 `deposit_fee` 不参与当前已部署质押入口，正式报价同步纠正；赎回手续费不变。
- `client.ts` / `planner.ts` / `types.ts`：唯一匹配转换器提供快照；用快照兑换率和费用计算闪电贷初值，再以整数精确重算兑换量、借款及费用。满足原精度、容量及风险检查后直接返回；快照不可用、金额不足或候选不满足原条件时回退旧求解器。非法数据及整体超时仍报错。
- 应用于开仓、追加本金和增加杠杆。USDSUI/USDC 保持价格初值 + 正式报价校验；降低杠杆、还款、赎回不使用原生质押快照。

这里的“0 次报价”专指不调用转换器的正式 `quote()`，不是 0 次 RPC，也没有去掉最终 build 模拟。

## 完整状态和精度依据

核对了 SDK 固定调用的已部署 Move 包原始字节码，证据哈希见
[`native-snapshot-bytecode.json`](../e2e/evidence/native-snapshot-bytecode.json)。不能把显示用小数汇率或 1 SUI 试算值当完整状态。

| 项目 | Volo | Haedal |
|---|---|---|
| 包 | `0x68d22c…dae20` | `0x19e6ea…4967c` |
| 完整状态来源 | 单个模拟 PTB：refresh → total_sui_supply → total_lst_supply → fee_config/stake_fee_bps → 实际执行 epoch | 单个 Staking 对象：total_staked、total_rewards、total_protocol_fees、uncollected_protocol_fees、total_unstaked、stsui_supply，以及 pause/version |
| SUI 总量 | 使用 refresh 后有效总量；不能直接拿 metadata 原始 total_supply | 按合约次序逐步进行 checked-u64 加减 |
| 质押手续费 | `ceil(input × feeBps / 10000)`，合约上限 500 bps | 当前固定包的 request_stake_coin 不读取 deposit_fee，实际为 0 |
| 铸币 | `floor((input − fee) × effectiveLstSupply / effectiveSuiSupply)` | `floor(input × stsuiSupply / totalSui)` |
| 零总量 | 按固定包的 bootstrap 分支返回净输入 | 同左 |
| 最小金额 | 保留 SDK 既有 1 SUI；合约自身 0.1 SUI，这次不放宽 | 保留 1 SUI |

本地计算显式检查 u64、费用及最小输出，不经过 JS Number 的资金换算。求借款初值使用高精度数值，最终费用仍按原闪电贷/借款整数取整规则重新计算。

链上兑换率只决定兑换量。协议 oracle 的抵押品/债务价格继续用于目标杠杆、HF、LTV 和容量；未用质押汇率替代风险价格。最小到账、最终链上 HF 断言和 build 模拟全部保留。

## 缓存和 epoch

1. 每个转换器实例按固定客户端、原生交易对缓存 5 秒；并发读合并。慢读超过 TTL 不接受，过期 pending 可重试。
2. 每次读取（包括命中缓存）先查询当前系统 epoch，epoch 不同即失效。Volo 模拟中的 epoch 覆盖开始读取时的 epoch。
3. 晚到的旧 epoch 结果不能覆盖较新的缓存，也不能作为已被新 epoch 淘汰的结果返回。返回副本，调用方不能污染缓存。
4. Haedal 的公式来自单个对象，当前入口本身没有 epoch refresh；Volo 必须在同一模拟 PTB 中先 refresh 再读全部数值。
5. 缓存 TTL 仅限制计算时复用，不把 executable quote 原有有效期缩成 5 秒。实际交易时状态仍可能变化，最终模拟/最小到账保护负责拒绝过时计划。
6. 快照读取与旧求解器共享 32 次/45 秒预算，不因回退重置。自定义 `getRateHint` 仍只作初值提示，必须正式报价校验。

## 本地回归

7 个测试文件、401 项通过；TypeScript、ESLint、SDK build、`git diff --check` 通过。ESLint 仅有既存的 React 自动检测环境提示。

| 验收点 | 覆盖 |
|---|---|
| 非零费用 | Volo 向上取整后铸币向下取整；1 SUI、1 SUI+1 atom、100、100000；组合非零质押/闪电贷/借款费；Haedal 即使存储 deposit_fee 非零仍按实际入口不扣费 |
| 已有仓位 | 开仓/追加本金/加杠杆，债务币和直接抵押品输入，大仓位追加小额本金；保持本金相对残差要求 |
| 最小金额 | 1 SUI−1、1 SUI、1 SUI+1；本金 0.5 SUI±1 atom、2x 时兑换恰跨 1 SUI，低于最小值回退正式/DEX 路径 |
| 跨 epoch | TTL 内切 epoch；读取中跨 epoch；旧请求晚到；Volo 同一模拟返回新 epoch；缓存复制与并发合并 |
| 故障 | 慢读超过 TTL、过期 pending 重试、暂停/版本错误不缓存、provider 不匹配、u64 中间溢出/下溢、快照失败回退、共享 45 秒超时 |
| 风险 | 按最小输出判断 HF/容量，危险候选不能绕过原检查，未放宽原收敛精度 |

跨 epoch 和非零手续费是确定性的回归场景；本次真实主网运行处于 epoch 1321，两条原生质押费均为 0，没有宣称真实跨越 epoch 或修改主网费用做验收。

## 完整 build 主网模拟

使用用户钱包 `0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe` 的真实公开资金状态，`checksEnabled: true`。

使用仅供这笔模拟的新 Registry 数字键，避免受已有仓位影响；注册、Cap 创建、E-Mode、闪电贷、质押/兑换、存入、借款、偿还、HF 校验均在同一完整 PTB 中执行，不广播。

| 策略 | 本金 / 目标杠杆 | 策略正式报价 | 模拟 HF（约） | 结果 |
|---|---|---:|---:|---|
| vSUI/SUI | 1 SUI / 2x | 0 | 1.860000003 | 完整成功；实际铸币与快照逐 atom 相同 |
| haSUI/SUI | 1 SUI / 2x | 0 | 1.500000000 | 完整成功；实际铸币与快照逐 atom 相同 |
| USDSUI/USDC | 0.1 USDC / 2x | 1 | 1.739930221 | 完整成功 |

钱包没有足额 USDC，因此 USDSUI 案例在同一模拟 PTB 前置真实 0.3 SUI → USDC 兑换来提供本金，不伪造 coin、不关闭资金检查；此前置资金兑换有额外一次报价，不计入策略报价次数。

共 10 个断言场景通过：3 个完整成功、2 个原生铸币精确对账、2 个把 minOutput 提高到真实铸币量+1 atom 的指定 guard 失败、3 个把最终 HF 门槛提高到 2 的指定 HF guard 失败。HF 用同一模拟仓位与协议 oracle/LT/borrow weight 独立复算，误差 < 1e-6。

可复跑脚本：[native-snapshot-build.mjs](../e2e/native-snapshot-build.mjs)。
汇总及 PTB 字节哈希：[native-snapshot-build.json](../e2e/evidence/native-snapshot-build.json)。
完整命令、报价、模拟响应保存在 `/private/tmp/multiply-native-snapshot-20261124/build-sim/`。

## 性能实测

对照是 `0e8f2a9` 的旧 planner；客户端和转换器采用相同当前构建，隔离求解器变化。候选运行时源码 SHA-256 固定在证据中。不是用上个阶段单次测量代替本次对照。

相同公开空钱包，2x、50 bps 滑点，逐轮交替前后顺序。计时包含完整 SDK quote 的 Cap、market、fee 读取和转换计算；不含 API HTTP、估值、保存、前端防抖。三个策略沿用当前配置：vSUI E-Mode 0、haSUI 普通 main、USDSUI E-Mode 2。

100 本金：每策略 3 轮中位数，总计 27/27 报价成功。

| 策略 | 正式报价次数：旧 → 新 | 旧求解器 | 新：冷读 | 新：同实例连续报价 | 冷读快照 / 连续快照耗时 |
|---|---:|---:|---:|---:|---:|
| vSUI/SUI | 3 → 0 | 4.308s | 3.757s | 2.808s | 0.868s / 0.289s |
| haSUI/SUI | 3 → 0 | 3.405s | 2.545s | 2.273s | 0.517s / 0.285s |
| USDSUI/USDC | 3 → 1 | 4.443s | 2.826s | 2.655s | 无原生快照 |

100000 本金：每策略 1 轮，总计 9/9 成功，仅作大金额核验，不作为稳定延迟承诺。

| 策略 | 正式报价次数：旧 → 新 | 旧求解器 | 新：冷读 | 新：连续报价 |
|---|---:|---:|---:|---:|
| vSUI/SUI | 3 → 0 | 5.269s | 2.569s | 2.045s |
| haSUI/SUI | 3 → 0 | 3.235s | 2.373s | 2.164s |
| USDSUI/USDC | 3 → 1 | 4.938s | 3.385s | 2.555s |

连续报价的快照耗时仍包含 epoch RPC。Volo 冷读还包含完整 refresh 模拟，因此耗时不会降为零；其他市场/Cap 读取现在占更大比重。样本少且有公共 RPC/行情波动，不将上述差值表述为线上保证。

原始数据：[100 本金](../e2e/evidence/native-snapshot-100.json)、[100000 本金](../e2e/evidence/native-snapshot-100000.json)。
