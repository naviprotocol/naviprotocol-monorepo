# AccountCap 闪贷修改与功能验证

2026-11-24。本文记录发布前本地验证，不代表 Preview 已部署。无签名、无广播。

## 改动

闪借改为 `flash_loan_with_account_cap_v2`，在金额与 SuiSystemState 之间传入策略 AccountCap；还款改为 `flash_repay_with_account_cap`，最后一个参数使用同一个 Cap。借入币种仍是债务币，Astros、oracle 更新、费用、容量、HF/LTV/maxLeverage 和资金检查保持不变。新增 10 项回归覆盖普通/模拟构建、新建/已有/外部传入及 transient Cap、开仓/加减杠杆/平仓的 Cap 和 receipt 连接。

SDK 530/530 回归、类型检查、ESLint、构建通过。发布版本计划为 `0.2.0-preview.20261124.4`，仅 preview 标签。

钱包：`0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe`。RPC：`https://sui-grpc-web.publicnode.com`，来自 PublicNode 官方页面。SDK 使用当前本地修改构建，API 基于 #481 的 7b5c5480，临时加载此 SDK。风险参数使用此前已确认的 Preview 准入配置，未降低 HF/LTV 或跳过资金检查。

## 结果

- SDK：7/7 场景完整模拟成功，checksEnabled=true。vSUI 与 haSUI 各覆盖真实已有仓位加杠杆、减杠杆、平仓；USDSUI 当前无活跃仓位，以真实钱包 0.1 USDC 开仓至 5.69x。
- HTTP API：17/17 请求为 200，8/8 build 完整模拟成功，包括 USDSUI 无 quoteId 开仓。
- 每份 API 交易字节已检查 AccountCap 版闪借和还款的 Cap 参数相同，没有 ctx 版调用；交易字节哈希与返回值一致，oracle 更新先于借贷。
- SDK 7 份模拟中的 FlashLoan 和 FlashRepay 事件 sender 相同；已有仓位对应真实 Cap accountOwner；闪借本金与报价一致。
- 两个平仓 PTB 均执行协议抵押余额与债务余额双零检查，完整模拟成功。
- 真实钱包已有 vSUI、haSUI 仓位，未伪造空仓去测试这两者新开仓；新建 Cap 由 USDSUI 开仓覆盖。

## API 单次耗时

| 请求 | HTTP | 秒 | 模拟 |
|---|---:|---:|---|
| catalog | 200 | 3.75 | — |
| positions | 200 | 6.53 | — |
| main-vsui-sui-quote | 200 | 6.14 | — |
| main-vsui-sui-build | 200 | 6.02 | success |
| main-vsui-sui-decrease-quote | 200 | 6.56 | — |
| main-vsui-sui-decrease-build | 200 | 2.44 | success |
| main-vsui-sui-close-quote | 200 | 6.40 | — |
| main-vsui-sui-close-build | 200 | 2.03 | success |
| main-hasui-sui-quote | 200 | 31.85 | — |
| main-hasui-sui-build | 200 | 3.22 | success |
| main-hasui-sui-decrease-quote | 200 | 7.56 | — |
| main-hasui-sui-decrease-build | 200 | 2.40 | success |
| main-hasui-sui-close-quote | 200 | 5.51 | — |
| main-hasui-sui-close-build | 200 | 2.95 | success |
| main-usdsui-usdc-quote | 200 | 4.42 | — |
| main-usdsui-usdc-build | 200 | 2.68 | success |
| main-usdsui-usdc-direct-build | 200 | 6.98 | success |

haSUI 加杠杆 quote 有一次 31.85 秒慢请求，其后 build 成功；这是功能通过但仍有报价延迟的记录，不作为性能达标结论。

## 初次本地配置问题

初次 API 进程未加载 MULTIPLY_PHASE1_ADMISSION，新增敞口返回 OPEN_DISABLED。仅本地重新加载已有 Preview 准入配置后，上述 17 次正式复验全部成功。远端环境未变更。

## 证据

- SDK 原始报价、PTB、完整模拟、事件验证：本目录。
- API 原始请求/响应：/private/tmp/multiply-cap-publicnode-api-final/report.json。
- 紧凑证据：[紧凑验证数据](account-cap-flashloan-evidence-20261124.json)。
