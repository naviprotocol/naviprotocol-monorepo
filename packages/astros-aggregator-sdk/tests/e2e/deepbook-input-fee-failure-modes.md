# SDK 2.0.9：DeepBook 改用输入币付手续费（下掉 sponsored_deep）失败方式

背景：NAVI 的 `sponsored_deep` 替用户付 DeepBook 手续费，11/03 被刷空，决定下掉 sponsor（Linear ENG-5458，方案文档 https://claude.ai/artifact/GXWkga58CquvUzyzgqv9GA ）。2026-11-16 赞助池 DeepPool 只剩 0.092 DEEP，SDK 2.0.8 的 DeepBook 成交在 `sponsored_deep` 里 `balance::split` abort(2)。

2.0.9 的改动：
- `makeDeepbookPTB` 直接调 DeepBook v9 `pool::swap_exact_base_for_quote` / `swap_exact_quote_for_base`，DEEP 参数传 `0x2::coin::zero<DEEP>`。链上看到 DEEP 为 0，判定 `pay_with_deep = false`，手续费 taker fee × 1.25 从输入币扣。
- 第三个返回值（DEEP 币）用 `transfer_nonzero` 转给用户：恒为 0 时不产生对象。
- `find_routes` 的 `version` 17 → 18。后端（dex-aggregator-backend #797 / #798）只把 DeepBook 路由给 version ≥ 18，并按输入币付费报价。
- 不再需要 v9 只读调用抬 linkage（直接调 v9 本身就是 v9 linkage）。

## 失败方式

| # | 失败方式 | 后果 | 怎么防 / 怎么验 |
|---|---|---|---|
| S1 | 函数名或参数顺序不对 | 每笔 DeepBook 交易失败 | 2026-11-16 GraphQL 查 v9 `pool` 模块：`swap_exact_base_for_quote(Pool<B,Q>, Coin<B>, Coin<DEEP>, u64, &Clock, &mut TxContext) -> (Coin<B>, Coin<Q>, Coin<DEEP>)`，`swap_exact_quote_for_base` 输入为 `Coin<Q>`，返回相同；E2E 实际执行 |
| S2 | 第三个返回值（DEEP 币）没被消费 | 真实执行报 `UnusedValueWithoutDrop`（`checksEnabled:false` 的模拟看不出来） | 用 `transfer_nonzero` 处理；E2E 用持币地址、打开检查模拟整笔交易 |
| S3 | DEEP 币不是 0 | `destroy_zero` 会 abort；转给我们会拿走用户的钱 | 有余额才转给用户；后端 E2E 在多个池子上实测恒为 0 |
| S4 | lot 取整剩下的输入币（找零） | 处理不对会丢币或 unused value | 原有处理不变：a2b 把 base 找零转回用户，b2a 把 quote 找零转回用户 |
| S5 | `amountLimit`（最小输出）放错位置 | 滑点保护失效或误触发 | 仍是第 4 个参数（`min_quote_out` / `min_base_out`），语义同 sponsored 函数 |
| S6 | 成交结果与后端报价不一致 | 报价虚高，滑点触发失败 | 后端已证明 `input_fee` 报价 = 这条 v9 直接调用的链上结果（逐整数）；本 E2E 再对照 SDK 拼的整笔交易与同一时刻的参考直接调用，输出必须相等 |
| S7 | 池子 `allowed_versions` 不含 v9 | abort 11 | 与 2.0.8 相同的约束（原来的只读调用也要求 v9）；包 id 沿用 `deepbookLinkagePackageId` |
| S8 | 老后端（未部署 #798）也会给 version 18 返回 DeepBook，曲线仍是 DEEP 付费口径 | 报价偏高约 taker fee × 1.25，真实成交少于报价，可能触发滑点 | 后端先部署 #798 再发 SDK；发布顺序写进 PR |
| S9 | 后端通过报价覆盖 SDK 配置 | 若覆盖 DeepBook 相关键会改变调用 | 后端 `applyAggregatorConfigOverridesFromQuote` 只覆盖 kriyaV3 的键 |
| S10 | `AggregatorConfig` 是公开导出的对象，删除 `deepSponsored*` 键会破坏读它的外部代码 | 外部编译失败 | 保留这两个键，只标注不再使用 |

## E2E

`tests/e2e/deepbook-input-fee.ts`：向后端要 version 18、providers=deepbook 的报价（只读），用本 SDK 的 `buildSwapWithoutServiceFee` 拼整笔交易，用持币地址（同时持有 SUI / USDC / DEEP）打开检查在主网 simulate（不签名、不广播）。覆盖 SUI、USDC、DEEP 作输入（DEEP 既是输入币又是手续费币），a2b / b2a，单路由与多路由。同时 simulate 一笔参考交易（同一路由，每跳 v9 直接调用、DEEP 传 0），比较用户最终收到的目标币数量。判据：SDK 交易成功、没有触碰 DeepPool、收到数量与参考相等（两笔读到的池子版本相同时）。
