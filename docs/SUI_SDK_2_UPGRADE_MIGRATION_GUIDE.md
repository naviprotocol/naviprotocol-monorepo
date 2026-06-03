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

const client = createNaviSuiClient()
```

如果业务已有自定义 RPC endpoint：

```ts
import { createNaviSuiClient } from '@naviprotocol/lending'

const client = createNaviSuiClient('https://fullnode.mainnet.sui.io:443', 'mainnet')
```

Pyth update 不再依赖 `@pythnetwork/pyth-sui-js` 作为 lending 主依赖。SDK v2 beta 使用 NAVI 自维护 Hermes / Pyth v2 helper：

```ts
import { Transaction } from '@mysten/sui/transactions'
import { SuiPriceServiceConnection, SuiPythClient } from '@naviprotocol/lending'

const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
const pyth = new SuiPythClient(client, pythStateId, wormholeStateId)
const tx = new Transaction()

const updateData = await connection.getPriceFeedsUpdateData([
  '0xe62df6c8b4a85fe1a67a56e9a2a15...'
])

await pyth.updatePriceFeeds(tx, updateData, ['0xe62df6c8b4a85fe1a67a56e9a2a15...'])
```

当前 beta 限制：Pyth helper 已有单元测试和 type-compat 覆盖 Hermes id normalization、VAA decode 和 public helper 导出；dry-run、真实小额 execute、链上查询仍需作为交付 smoke 补齐。

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

当前 beta 限制：Suilend protocol 已从默认生产路径隔离为 legacy optional adapter，普通 wallet root import 和默认 lending module 不再加载 Suilend；如业务显式启用 `configs.lending.enableSuilend=true`，仍需自行安装 optional peers，并承担该 legacy 依赖链的 Sui v1 / `@mysten/sui.js` 风险，直到有已验证的 v2-safe Suilend stack。

## Astros Aggregator SDK

安装：

```bash
pnpm add @naviprotocol/astros-aggregator-sdk@2.0.0-beta.0 @mysten/sui@^2
```

消费方应使用 v2 `Transaction` 和 v2 client，不再传入旧 `SuiClient`。最小 smoke 应覆盖 route -> PTB build -> dry-run / simulate parser。

```ts
import { Transaction } from '@mysten/sui/transactions'
import { dryRunSwapTransaction, getQuote } from '@naviprotocol/astros-aggregator-sdk'

const quote = await getQuote('0x2::sui::SUI', navxCoinType, '1000000000')
const tx = new Transaction()

// Use swap PTB helpers to append route calls, then dry-run through a v2 client.
const dryRun = await dryRunSwapTransaction(tx, { client })
```

当前 beta 状态：Aggregator 已有确定性 PTB build、execute DTO 和 dry-run DTO 单元测试；真实前端 swap execute 仍需在前端依赖/build blockers 清理后用授权测试钱包补齐。

## Astros Bridge SDK

安装：

```bash
pnpm add @naviprotocol/astros-bridge-sdk@2.0.0-beta.0 @mysten/sui@^2
```

Bridge v2 beta 采用 internal lazy Mayan adapter：

- root entry 不应加载 Mayan / Sui v1。
- 只有调用 Sui source bridge build/swap 路径时才 dynamic import Mayan provider。
- adapter 内部使用 Mayan v1 构建 Sui source transaction，并通过 Sui v2 wallet connection 签名、执行。
- root `swap()` 返回 NAVI `BridgeSwapTransaction` DTO；状态查询使用 `getTransaction(hash)` 或 `getWalletTransactions(address)`。

示例：

```ts
import { getQuote, getTransaction, swap } from '@naviprotocol/astros-bridge-sdk'

const { routes } = await getQuote(fromToken, toToken, '1000000000', {
  slippageBps: 50
})

const transaction = await swap(routes[0], fromAddress, toAddress, {
  sui: {
    provider: client,
    signTransaction
  }
})

const latestStatus = await getTransaction(transaction.bridgeSourceTxHash)
```

当前 beta 状态：SDK root lazy、Mayan Sui v2 sign/execute/wait contract、quote/status DTO、前端 lazy chunk scan 和 Astros 多 route HTTP smoke 已有证据；真实 Bridge 小额 execute/status 仍需授权测试钱包补齐。

## Astros DCA SDK

安装：

```bash
pnpm add @naviprotocol/astros-dca-sdk@2.0.0-beta.0 @mysten/sui@^2
```

DCA create-order PTB 需要覆盖 SUI 和非 SUI 输入资产：

```ts
import { createDcaOrder, dryRunDcaTransaction, TimeUnit } from '@naviprotocol/astros-dca-sdk'

const tx = await createDcaOrder(client, userAddress, {
  fromCoinType: '0x2::sui::SUI',
  toCoinType: navxCoinType,
  depositedAmount: '1000000000',
  totalExecutions: 10,
  frequency: { value: 1, unit: TimeUnit.HOUR },
  priceRange: {
    minBuyPrice: 40000000,
    maxBuyPrice: 50000000
  }
})

const dryRun = await dryRunDcaTransaction(tx, { client })
```

当前 beta 已补充 SUI-funded create order、非 SUI merge/split coin path、cancel PTB、create/cancel dry-run DTO 单元测试。真实 execute smoke 仍需用授权测试钱包小额金额补齐。

## 可 Typecheck 示例

仓库内提供一个关键 public API 示例，覆盖 lending、wallet-client、aggregator、bridge、DCA 的 v2 import 和 DTO helper：

```bash
pnpm exec tsc --noEmit -p docs/examples/tsconfig.json
```

示例文件：`docs/examples/sdk-v2-smoke.ts`。

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

- package build/typecheck 和默认 package tests 已在 Node 22 通过；live smoke 仍不作为默认确定性 gate。
- `wallet-client` 默认生产路径已隔离 Suilend；显式启用 legacy Suilend optional adapter 仍不是 v2-safe 交付路径。
- frontend `apps/lending` build 仍被 Copilot 第三方协议 SDK 的 Sui v1-era imports 阻塞，不属于 SDK package 默认路径。
- 前端依赖树仍有 Copilot/store/legacy app 拥有的 Sui v1/v2 冲突，不能作为最终 clean v2 acceptance。
- Bridge、Pyth、lending、swap、DCA、wallet wrappers 的授权测试钱包真实小额 execute smoke 尚未全部完成。
