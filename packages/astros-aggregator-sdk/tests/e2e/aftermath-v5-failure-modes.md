# Aftermath 改调 amm v5：失败方式与 E2E（ENG-5208）

后端完整分析见 `naviprotocol/dex-aggregator-backend` 的 `docs/engine/aftermath-v4-failure-modes.md`。这里只列 SDK 这一侧。

## 背景

- 2026-11-13 Aftermath 发布 amm v4（`0x3a6928bd…`）和 v5（`0x93056cd8…`），PoolRegistry `protocol_version` 升到 4。
- SDK 原来调 v2（`0xc4049b2d…`）的 `swap::swap_exact_in`，它要求 registry **等于** 2，之后每笔都 abort 40。
- v5 的 `swap_exact_in` 签名与 v2 相同（pool、registry、fee vault、treasury、insurance fund、referral vault、coin、expected、slippage），函数体改成 `min_out = expected × (1 − slippage)` 后调 `swap_exact_in_direct`。所以只需要换包地址，参数不变。

## 失败方式

| # | 失败方式 | 后果 | 处理 | 验证 |
|---|---|---|---|---|
| S1 | 继续调 v2 | registry = 4 ≠ 2，abort 40 | `aftermathPackageId` 换成 v5 | E2E：交易成功 |
| S2 | 误用 v4 | v4 常量是 3，registry = 4 > 3，abort 63 | 用 v5（常量 4） | 同上 |
| S3 | 一笔交易里两个 Aftermath 包版本混用 | `InvalidLinkage` | 所有 Aftermath 跳都读同一个 `aftermathPackageId` | E2E 两跳用例 |
| S4 | `min_out` 过紧 | 正常波动 abort 48 | `amountLimit` = 报价的 90%，`min_out` = 它的 20%（约报价的 18%）；整笔交易的滑点仍由最后的 `check_slippage` 控制 | E2E：`minAmountOut` = 报价时成交成功 |
| S5 | 输出与后端报价不一致 | 到账 ≠ 报价 | 后端算价器按 v5 对拍（逐整数） | E2E：SDK 交易到账 = 参考交易（每跳直接调 v5 `swap_exact_in_direct`、min_out 0）；后端模式下同时记录到账与报价 `amount_out` 的差 |
| S6 | registry 再次升级或暂停 | v5 调用 abort 63 / 64 | SDK 无法自愈，需要再发版；后端会自动停止返回 Aftermath 路由 | 后端 E2E |
| S7 | 老版本 SDK 拿到 Aftermath 路由 | abort 40 | 后端按 find_routes 的 `version` 过滤，新 SDK 才返回 Aftermath | 后端 Stage 验证 |

## E2E

`npx tsx tests/e2e/aftermath-v5.ts`（在 `packages/astros-aggregator-sdk` 下），主网 simulate，不签名、不广播。

- 默认（合成路由）：从链上读池子类型，先 simulate 参考交易拿到精确输出 X，再用 X 作报价、`amountLimit = ⌊0.9X⌋`、`minAmountOut = X` 让 SDK 拼交易。
- `AG_API=<后端地址> AG_VERSION=<find_routes version>`：向后端要 `providers=aftermath` 的报价再拼交易。

判据：SDK 交易成功；SDK 读到的 Aftermath 池子版本与参考交易相同时，收款地址收到的币 = 参考输出（合成模式下即 = 报价）。产物 `tests/e2e/reports/aftermath-v5-<时间>.json`，有失败时退出码 1。
