# NAVI Sui SDK 2.0 Beta Migration Guide

日期：2026-06-03

## 适用范围

本指南面向准备从 NAVI SDK v1 切到 Sui SDK 2.0 beta 的前端、Node 服务和集成测试。

首批 beta package：

- `@naviprotocol/lending@2.0.0-beta.0`
- `@naviprotocol/wallet-client@2.0.0-beta.0`
- `@naviprotocol/astros-aggregator-sdk@2.0.0-beta.0`
- `@naviprotocol/astros-bridge-sdk@2.0.0-beta.0`
- `@naviprotocol/astros-dca-sdk@2.0.0-beta.0`

## 运行环境

SDK v2 需要 Node 22.x 或更高版本。本仓库 SDK 验证固定使用 Node `v22.22.2`。

```bash
node --version
pnpm --version
```

消费方需要安装 Sui SDK v2：

```bash
pnpm add @mysten/sui@^2
```

安装 NAVI beta package 时，优先使用真实 beta 发布包、preview 包或 `pnpm pack` 生成的 tarball，不使用源码 link 作为最终验收依据。

## Sui v2 Client 初始化

旧代码常见写法：

```ts
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

const client = new SuiClient({ url: getFullnodeUrl('mainnet') })
```

SDK v2 beta 兼容路径使用 v2 JSON-RPC client：

```ts
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

const client = new SuiJsonRpcClient({
  network: 'mainnet',
  url: getJsonRpcFullnodeUrl('mainnet'),
})
```

后续 public read/view API 会继续向 `ClientWithCoreApi` 或等价 v2 client contract 收敛。仍需要 JSON-RPC 能力的路径必须被视为明确兼容 adapter，不应把旧 v1 `SuiClient` 当成稳定 public contract。

## Import 迁移

推荐替换：

| v1 import | v2 beta import |
| --- | --- |
| `@mysten/sui/client` 的 `SuiClient` / `getFullnodeUrl` | `@mysten/sui/jsonRpc` 的 `SuiJsonRpcClient` / `getJsonRpcFullnodeUrl` |
| `@mysten/sui.js/transactions` 的 `TransactionBlock` | `@mysten/sui/transactions` 的 `Transaction` |
| `@mysten/bcs` | `@mysten/sui/bcs` |
| `@mysten/sui.js` root imports | 不再使用 |

## Lending

安装：

```bash
pnpm add @naviprotocol/lending@2.0.0-beta.0 @mysten/sui@^2
```

初始化 v2 client：

```ts
import { createNaviSuiClient } from '@naviprotocol/lending'

const client = createNaviSuiClient('mainnet')
```

如果业务已有自定义 RPC endpoint：

```ts
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

const client = new SuiJsonRpcClient({
  network: 'mainnet',
  url: 'https://fullnode.mainnet.sui.io:443',
})
```

Pyth update 不再依赖 `@pythnetwork/pyth-sui-js` 作为 lending 主依赖。SDK v2 beta 使用 NAVI 自维护 Hermes / Pyth v2 helper：

```ts
import { SuiPriceServiceConnection, SuiPythClient } from '@naviprotocol/lending'

const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
const pyth = new SuiPythClient(client, 'mainnet')

const updateData = await connection.getPriceFeedsUpdateData([
  '0xe62df6c8b4a85fe1a67a56e9a2a15...'
])

await pyth.updatePriceFeeds(tx, updateData, ['0xe62df6c8b4a85fe1a67a56e9a2a15...'])
```

当前 beta 限制：Pyth helper 已有单元测试覆盖 Hermes id normalization 和 VAA decode，但 dry-run、真实小额 execute、链上查询仍需作为交付 smoke 补齐。

## Wallet Client

安装：

```bash
pnpm add @naviprotocol/wallet-client@2.0.0-beta.0 @mysten/sui@^2
```

基础使用：

```ts
import { WalletClient } from '@naviprotocol/wallet-client'

const walletClient = new WalletClient({
  network: 'mainnet',
})

const balances = await walletClient.balance.getAllBalances()
```

当前 beta 限制：Suilend protocol 已从 root import 改为 lazy 初始化，避免普通 wallet root import 因第三方依赖副作用失败；但 Suilend 依赖链仍带 Sui v1 / `@mysten/sui.js` 路径，不能视为 SDK v2 ready。需要后续选择移除、隔离为 legacy lazy optional adapter，或升级到已验证的 v2-safe Suilend stack。

## Astros Aggregator SDK

安装：

```bash
pnpm add @naviprotocol/astros-aggregator-sdk@2.0.0-beta.0 @mysten/sui@^2
```

消费方应使用 v2 `Transaction` 和 v2 client，不再传入旧 `SuiClient`。最小 smoke 应覆盖 route -> PTB build -> simulate parser。当前 live route test 依赖 open-aggregator 生产路由，仍需拆成稳定 fixture / mock test 和独立 live smoke。

## Astros Bridge SDK

安装：

```bash
pnpm add @naviprotocol/astros-bridge-sdk@2.0.0-beta.0 @mysten/sui@^2
```

Bridge v2 beta 采用 internal lazy Mayan adapter：

- root entry 不应加载 Mayan / Sui v1。
- 只有调用 Sui source bridge build/swap 路径时才 dynamic import Mayan provider。
- adapter 输出标准 transaction bytes，消费方使用 Sui v2 wallet / `Transaction.from(bytes)` 解析、签名和执行。

示例：

```ts
import { Transaction } from '@mysten/sui/transactions'
import { getQuote, swap } from '@naviprotocol/astros-bridge-sdk'

const quote = await getQuote(params)
const result = await swap({ ...params, quote })

const tx = Transaction.from(result.txBytes)
```

当前 beta 限制：SDK root lazy 单元测试已通过；v2 parse、dry-run、sign、execute、status、多 route smoke 和前端 chunk 检查仍是交付门槛。

## Astros DCA SDK

安装：

```bash
pnpm add @naviprotocol/astros-dca-sdk@2.0.0-beta.0 @mysten/sui@^2
```

DCA create-order PTB 需要覆盖 SUI 和非 SUI 输入资产：

```ts
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
// SDK create order builder appends Move calls to the v2 transaction.
```

当前 beta 已补充 SUI-funded create order 和非 SUI merge/split coin path 单元测试。真实 simulate / execute smoke 仍需用授权测试钱包小额金额补齐。

## 前端消费验收

最终验收必须在 `copilot` 的 `feat/mysten-sui-2.0` 分支安装 SDK v2 tarball、preview package 或 beta package 后执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck:all
pnpm build
pnpm why @mysten/sui @mysten/sui.js @pythnetwork/pyth-sui-js @mayanfinance/swap-sdk --recursive
```

验收目标：

- NAVI SDK 不再触发 `@mysten/sui/client` 中旧 `SuiClient/getFullnodeUrl` 导出错误。
- 前端主应用可接受的 `@mysten/sui` 版本走 v2。
- `@mysten/sui.js` 和 Sui v1 只能出现在明确 legacy / lazy adapter 路径，不能出现在 SDK root entry 或非 Bridge 页面 chunk。
- Bridge route build 必须证明 Mayan/Sui v1 只进入 lazy chunk。
- lending、swap、bridge、dca、wallet wrappers 用授权测试钱包完成小额 smoke。

## 已知 Beta 限制

- package build/typecheck 已在 Node 22 通过，但 package tests 尚未全部通过。
- 当前 package 仍输出 CJS + ESM，尚未满足严格 ESM-only checklist。
- `wallet-client` Suilend 依赖链仍是 v2 beta 交付 blocker。
- lending 动态链上测试和部分 v2 PTB resolver 行为仍需收敛。
- aggregator live route test 需要稳定 fixture 或 mock。
- Bridge 和 Pyth 的真实小额 execute smoke 尚未在本实现 pass 固化。
