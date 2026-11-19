# Multiply Registry 适配方案与代码改动清单

日期：2026-11-03。状态：**已按本方案完成本地代码适配；验证记录见 verification.md。**

按最新要求，Registry 的两个数字参数共同标识策略；Registry 是 Multiply Cap 的唯一发现来源。策略识别不读取 Cap name，不扫描或兼容旧 Cap。下文保留方案的设计说明；实现采用相同的固定编号和数字绑定。

## 1. 核心方案

| 项目 | 方案 |
| --- | --- |
| 策略标识 | 建议两个 u64 定义为 `strategyNumericId + strategyVersion`，共同构成固定 registry key |
| 登记内容 | `wallet → (strategyNumericId, strategyVersion) → capObjectId` |
| 发现来源 | 只查询 Multiply Registry；未登记 Cap 不展示、不复用、不迁移 |
| 策略解析 | Registry 数字组合 → SDK/API 策略目录 → 具体 market、币种和执行规则 |
| Cap 校验 | 批量读取对象，验证类型、当前所有权、accountOwner 和重复绑定 |
| metadata | 从发现与执行校验中移除 name/description；新 Cap 首版也无需设置这两个字段 |
| 新建仓位 | 创建 Cap、按固定策略 key 登记、执行开仓，放在同一个 PTB |
| 关闭仓位 | 保留登记和空 Cap，后续同策略开仓复用 |
| Open API / Frontend | 请求仍使用字符串 strategyId；返回 Cap 的数字绑定，移除对 Cap name 的依赖 |

同一钱包、同一个固定数字组合最多对应一个当前登记记录，重复注册由现有合约拒绝。该约束以数字组合为范围，不依赖 Cap name。

## 2. 合约与策略编号

部署网络：`sui:mainnet`。

| 配置 | 值 |
| --- | --- |
| Registry package | `0xe98ff1aab2414aa2e60d0561284d011b3c486d47313b51700a2691ad4d37b162` |
| Registry shared object | `0x1fb36a5acfcb96b75f0be8869fd6acebbe7586e3e271b81ae4cdcb8ae4ebdd39` |
| Registry module | `multiply_registry` |
| AccountCap 类型原点 | `0x66c91a8560cd64d73d93dd1ec7b61f3f21ad2f66553dd3d7038ca69255479bb7::account::AccountCap` |

现有 ABI：

```move
register_mul_for_account_cap(
    registry: &mut MultiplyRegistry,
    cap_address: address,
    key_part_1: u64,
    key_part_2: u64,
    ctx: &mut TxContext,
)

find_user_mul_account_caps(
    registry: &MultiplyRegistry,
    user: address,
): (vector<u64>, vector<u64>, vector<address>)

unregister_mul_for_account_cap(
    registry: &mut MultiplyRegistry,
    key_part_1: u64,
    key_part_2: u64,
    ctx: &mut TxContext,
)
```

合约确定的行为是：外层使用交易 sender；内层 key 为 `key_part_1 * 100000 + key_part_2`；注册要求 `key_part_2 < 100000`，且组合键不能重复。以下数字的业务意义由 SDK/API 统一约定，**不是合约自带的参数名称或既有编号**。

建议首批映射：

| 前端/API strategyId | strategyNumericId | strategyVersion | 合成 key | 执行 market |
| --- | --- | --- | --- | --- |
| `vsui-sui` | `1` | `1` | `100001` | `vsui-sui` |
| `hasui-sui` | `2` | `1` | `200001` | `hasui-sui` |
| `short-sui` | `3` | `1` | `300001` | `main` |

例如 vSUI/SUI 的注册调用固定传 `(capId, 1, 1)`；查询返回 `(1,1,capId)` 后直接解析为 `vsui-sui`，无需查询对象名称。每个钱包使用同一套编号，编号不随登记顺序或目录排序变化。

编号规则：

- 配置和 JSON 中使用十进制 string，计算使用 bigint；校验两个值及合成值都在 u64 范围内。
- 本适配约定数字策略 ID 从 1 开始，版本为 `1..99999`；合约自身仅规定第二个参数 `< 100000`。
- 数字组合与完整策略执行定义绑定，包括 market 和三种币型；同一组合不可重新解释成另一种策略，不回收使用过的策略编号。
- SDK/API 初始化时拒绝重复组合、重复 canonical strategyId，以及不一致的映射。aliases 只解析到 canonical strategyId，不另占数字组合。
- 首版每个字符串 strategyId 只启用表中的一个版本。若以后启用多版本，需要明确各版本的独立发现与选择方式，不能把历史数字组合静默解析为最新版本。
- Auto/Vault 继续使用自己的 adapter，不分配本次 Manual AccountCap 的数字 key。

数字策略 ID、字符串 strategyId 和 market 是不同概念；不把这里的编号当作 NAVI Lending 或 E-Mode 已有的市场编号。

## 3. 读取与策略解析

```text
wallet
  → find_user_mul_account_caps(registry, wallet)
  → 解码三个等长数组，组成 (numericId, version, capId)
  → 按固定数字组合解析 Strategy
  → 批量读取 Cap 对象：类型、owner、accountOwner
  → 按 Strategy 指定的 market 读取仓位并校验资产与风险模式
  → Position[]
```

### 3.1 Registry 是唯一来源

1. 用现有只读模拟封装调用 Registry getter；失败、返回值缺失或 BCS 解码异常统一报 `READ_FAILED`。
2. 三个数组按相同 index 组合；校验长度一致、u64 范围和地址格式，不允许截断配对。
3. 使用整个 `(strategyNumericId, strategyVersion)` 查询策略目录，不能只匹配其中一个数字。
4. 未知数字组合返回 `UNSUPPORTED_REGISTRY_STRATEGY`，不猜测策略，不将其静默隐藏为成功空仓。
5. Registry 成功返回空数组时，Multiply 仓位就是空；即使钱包还持有旧的、未登记的 Multiply Cap，也不纳入本次产品结果。

不再调用 `listOwnedObjects` 寻找旧 Cap，不调用 `get_account_info`、`listDynamicFields` 或 `getDynamicField` 读取 name/description，也不提供迁移或补登记路径。

这里仍可以使用 dry-run **查询 Registry**，并继续进行正常仓位读取与交易模拟；删除的是依赖 Cap name 区分策略的那一层 dry-run。

### 3.2 批量核验 Cap

Registry 只保存 address，不验证对象。对返回的记录执行批量 `getObjects`，按响应中的对象 ID 映射结果，不能依赖服务端返回顺序：

- 对象存在，且类型是 canonical AccountCap。
- 默认钱包路径要求对象当前由请求钱包直接持有；`checksEnabled: false` 本身不证明所有权。
- 从对象内容取得 `accountOwner`，继续用它读取借贷账本。Registry 中保存的是 Cap 对象 ID，两者不可混用。
- 同一 Cap ID，或同一借贷 accountOwner，被登记到不同策略组合时拒绝自动计价和操作，避免重复使用同一账户。首版采用一 Cap / 一账户对应一个 Multiply 策略的模型。
- 保留现有 E-Mode 排除与目标市场账本校验：已登记 Cap 仍不能绕过不支持的风险模式或混合资产检查。E-Mode 索引可与 Multiply getter 放进同一个只读 PTB，不恢复钱包扫描或 name 识别。

无效、已转出、已删除、错误类型的登记记录报 `INVALID_ACCOUNT_CAP`，不能把它当作“尚未开仓”。未知策略、重复绑定和不完整对象读取也不返回部分成功的空仓快照。

读取链路不再验证 name/description；策略执行定义来自固定数字映射。登记记录表达钱包的策略绑定，实际余额、资产组合和健康度仍必须从目标市场读取并校验。

### 3.3 请求内复用

单次 `getPosition(wallet)` 只获取一次 Registry/Cap 快照，再给各策略复用，避免每个策略分别读取。Open API 同一请求内共享这个 Promise；quote 和 build 各自重新读取，不跨两次操作复用旧快照。

批量对象读取按客户端请求上限分组，限制并发与整体耗时。Registry 数据本身没有分页接口，超出响应或执行预算时明确报错，不输出截断列表。前端遇到读取错误继续保留上一份成功数据。

## 4. 创建、登记和并发

新 Cap 的 PTB：

```text
检查 sender == quote.address
  → lending::create_account
  → 从新 Cap 引用取得对象地址
  → register_mul_for_account_cap(registry, capId, numericId, version)
  → 现有存款 / 兑换 / 借款 / HF 检查
  → 调用方接收 createdAccountCap 与剩余 Coin
```

新 Cap 无需写入 name 和 description。新对象 ID 从 PTB result 经已核验的 Sui object helper 得到 address，不能预先猜测，也不能把 TransactionResult 当作 pure address。

创建、登记与开仓在同一笔交易中成功或回滚。默认钱包路径最终将 Cap 交给报价钱包；API 继续负责接收 `createdAccountCap` 和 Coin。发送交易仍由调用钱包完成。

同一策略的生命周期：

| Registry / 仓位状态 | 行为 |
| --- | --- |
| 固定策略 key 不存在 | `open` 创建并登记；其他操作返回仓位不存在 |
| key 存在，Cap 有仓位 | 复用该 Cap；重复 open 按既有规则拒绝 |
| key 存在，Cap 为空 | open 复用该 Cap，不再次注册 |
| close 成功 | 保留 Cap 和 Registry key |
| key 指向无效 Cap | 报错，不自动注销、覆盖或改用其他 key |

Registry 按交易 sender 登记，因此 sender 未设置时设置为 quote.address，已设置但不一致则拒绝；赞助 gas 的 gas owner 可不同。SDK/API 不在普通交易中自动注销记录。

### 4.1 报价绑定

ExecutionPlan 升级为 version 3，固定保存部署、数字策略 key 和执行定义指纹：

```ts
interface RegistryKey {
  strategyNumericId: string
  strategyVersion: string
}

type CapRegistrationPlan = {
  deploymentId: string // network + Registry package + object
  key: RegistryKey
  strategyFingerprint: string // key + market + coin types 等执行定义
} & (
  | { kind: 'create' }
  | { kind: 'existing'; capId: string; accountOwner: string }
)
```

实现将 Registry 配置存入 execution.capRegistry，并将完整 Strategy（包含 registryKey）与执行计划一起纳入 quote checksum；无需单独存储重复的 fingerprint 字段。checksum 只是修改检测，不是签名；API 仍从服务端保存的报价取执行计划。无需绑定共享 Registry 的全局对象版本，避免其他钱包写入导致无关报价过期。

build 重新检查：

- 配置和策略映射与报价一致。
- create 报价对应的固定 key 仍为空；existing 报价仍指向相同 Cap 和 accountOwner。
- Cap 所有权、实际仓位和市场配置满足现有校验。
- 即使 API 已缓存 build 字节，也要执行这些检查；不能只重新模拟旧字节。

两个并发 open 使用同一钱包、同一策略 key：预检查发现变化则报 `STALE_QUOTE`；build 后发生竞争则由链上重复 key 检查拒绝其中一笔，整笔失败交易回滚。不同策略使用不同 key，不竞争同一个登记位置，但仍共同访问共享 Registry。

对已确认来自本 Registry 注册调用的重复 key abort，提示重新 quote；不能把任意模块的 `10001` 都归类成该错误。用户确认前不自动重签、重广播。

Cap name 被修改不影响本方案的策略识别或报价有效性；数字映射、登记地址或真实仓位变化才进入相应的重新校验。

## 5. SDK 接口与改动清单

新增类型提案：

```ts
interface Strategy {
  id: string // 保持现有字符串 ID
  registryKey: RegistryKey
  market: string
  principalCoinType: string
  collateralCoinType: string
  debtCoinType: string
  emodeId?: number
}

interface AccountCap {
  id: string
  accountOwner: string
  strategyId: string
  registryKey: RegistryKey
}

type CapRegistryConfig = {
  network: 'sui:mainnet'
  packageId: string
  objectId: string
}
```

AccountCap 中移除用于身份校验的 `name` 和从链上 description 解析的 `strategy`；由注册数字组合解析出已配置 Strategy。quote 中 create 分支也改为携带 registryKey。SDK 的 `getPosition / quote / buildPTB` 主方法参数保持原有形状，传入的 Strategy 必须有固定 registryKey。

`createMultiplyClient` 与 `createNaviDataSource` 使用同一冻结的 Registry 部署和策略映射。默认 mainnet 路径使用上述部署；自定义链客户端必须明确提供匹配配置。custom DataSource 需满足新数字绑定契约，不添加旧 name resolver 回退；现有 Auto/Vault 服务不接入这套 Manual Registry。

SDK 根目录：`/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply`。

| 文件 | 计划改动 |
| --- | --- |
| `src/cap-registry.ts`（新增） | Registry lookup、三数组 BCS 解码、固定组合解析、参数范围校验、注册 PTB；不包含空闲 slot 分配或迁移 helper |
| [src/strategies.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/strategies.ts) | 内置策略加入固定 registryKey；身份路径移除 capName；校验 SDK presets 与 API 注入定义一致 |
| [src/types.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/types.ts) | 增加 RegistryKey 和部署配置；更新 Strategy、AccountCap、ExecutionPlan v3；删除 name/description 身份字段 |
| [src/data-source.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/data-source.ts) | 用 Registry lookup + 批量对象读取替换 owned-object/metadata 扫描；保留必要的 E-Mode 和账本校验 |
| [src/client.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/client.ts) | 一次发现给所有策略复用；findCap 按完整数字组合匹配；quote/build 固定绑定；创建 Cap 时注册；移除 metadata 设置与校验 |
| [src/planner.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/planner.ts) | 调整 v3 类型组装；数字绑定由 client 追加，现有杠杆算法继续复用 |
| [src/index.ts](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/src/index.ts) | 导出新配置和类型，清理仅用于旧名称识别的导出 |
| `tests/cap-registry.test.ts`（新增）及现有 generic 测试 | 覆盖固定编号、合约约束、批量对象响应、重复绑定、报价竞争和原子登记 |
| [package.json](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/package.json) | 新 preview 版本；test 脚本覆盖全部新增用例 |
| [e2e/persisted-position.mjs](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/e2e/persisted-position.mjs) 与 registry E2E | 测试数据改为 Registry 已登记 Cap；额外验证未登记 Cap 被排除 |
| [README.md](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/README.md)、[docs/design.md](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/docs/design.md)、[docs/verification.md](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/docs/verification.md) | 更新固定编号、发现来源、SDK 结构变化和验证记录 |

本版不新增 cap-metadata 批处理模块、缺字段二分逻辑、旧 Cap 扫描、兼容模式开关或补登记 helper。

## 6. Open API 与 Frontend

### 6.1 Open API

实际接口工作区：`/Users/zado/.codex/worktrees/0ddd/navi-open-api`，分支 `zado/multiply-api-registry`。

现有产品策略目录是固定数字组合与执行定义的配置来源；链上 Registry 保存每个钱包在该组合下的 Cap。API `strategyRegistry.execution()` 向 SDK 传入完整 registryKey，避免读写各用一套编号。

| 文件 | 计划改动 |
| --- | --- |
| [registry.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/registry.ts) | execution schema 增加 registryKey；三条定义加入固定编号；创建 byRegistryKey 索引；启动时检查唯一性、范围和执行绑定 |
| `src/services/multiply/cap-registry-deployment.ts`（新增） | 固定 mainnet package/object 及部署指纹；不接受请求任意覆盖 |
| [client.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/client.ts) | 将同一部署与策略定义注入 SDK 和 DataSource；请求内缓存 Registry Cap 列表 |
| [positions.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/positions.ts) | 仅聚合已登记仓位；accountCap 输出 registryKey，移除 name |
| [quotes.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/quotes.ts)、[build.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/build.ts) | 保存 v3 计划；SDK 版本、部署或策略映射变化使旧 quote 失效；缓存 build 仍检查当前 key → Cap 绑定 |
| [store.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/store.ts) | 更新新版 quote 类型与序列化测试，保留同一 quote 的交易字节一致性规则 |
| [errors.ts](/Users/zado/.codex/worktrees/0ddd/navi-open-api/src/services/multiply/errors.ts) | 加入未知数字策略错误，保留无效 Cap、重复绑定、状态过期和上游失败处理 |
| package.json、lockfile、vendor/multiply-sdk | 锁定新版 SDK，更新 tarball、manifest 与版本证据 |
| 服务测试、scripts/multiply、[接入文档](/Users/zado/.codex/worktrees/0ddd/navi-open-api/docs/multiply-api-frontend-integration-plan.md) | 更新 Registry fixture、返回结构、固定映射和新 Preview 验证结果 |

HTTP 端点和用户提交方式：

| HTTP | 路径 | 接入变化 |
| --- | --- | --- |
| GET | `/api/navi/multiply/strategies` | 增加 registryKey；现有 strategyVersion 来自固定映射 |
| GET | `/api/navi/multiply/positions` | accountCap.name 改为 registryKey；仍按现有产品/策略聚合 |
| POST | `/api/navi/multiply/quote` | 请求继续使用字符串 strategyId；响应 create Cap 信息携带 registryKey |
| POST | `/api/navi/multiply/build` | 仍提交 address、quoteId；内部生成固定数字登记调用 |

前端不提交或选择 numericId/version，它们由服务端 canonical strategyId 的映射确定。响应结构变化需要 SDK/API/前端一起更新，不能宣称本次 DTO 完全不变。

错误约定：`READ_FAILED → 502`；`INVALID_ACCOUNT_CAP / DUPLICATE_ACCOUNT_CAP / STALE_QUOTE → 409`；`UNSUPPORTED_REGISTRY_STRATEGY → 422`。配置重复或越界在初始化阶段拒绝，不等到用户交易时才失败。

### 6.2 Frontend

前端分支：`zado/multiply-unified-state-card`。

| 文件 | 计划改动/验证 |
| --- | --- |
| [services/multiply/index.ts](/Users/zado/code/navi/frontend-monorepo/apps/lending/src/services/multiply/index.ts) | 更新 Strategy/Position/Quote 类型：加入 registryKey、移除 accountCap.name；当前 UI 业务路径未发现读取该 name 字段 |
| [services/multiply/catalogue.ts](/Users/zado/code/navi/frontend-monorepo/apps/lending/src/services/multiply/catalogue.ts) 及 fixtures | 接收固定策略映射；产品标题继续使用 catalog displayName |
| [services/multiply/positions-query.ts](/Users/zado/code/navi/frontend-monorepo/apps/lending/src/services/multiply/positions-query.ts) | 回归新 DTO、读取失败保留数据、交易确认后新读取 |
| [hooks/multiply/useMultiplyTransaction.ts](/Users/zado/code/navi/frontend-monorepo/apps/lending/src/hooks/multiply/useMultiplyTransaction.ts) | 固定 key 竞争失败提示重新报价，不自动重签/广播 |
| [e2e/multiply/persisted-position.spec.ts](/Users/zado/code/navi/frontend-monorepo/apps/lending/e2e/multiply/persisted-position.spec.ts) 及交易/恢复测试 | fixtures 改为登记记录；覆盖新开仓、重复开仓、空 Cap 复用、未登记 Cap 排除与刷新 |

浏览器不增加链上 metadata 查询或旧 Cap 发现逻辑。Auto 继续沿用原有 adapter、显示及交易路径。

## 7. 验收与实施次序

| 类别 | 验收点 |
| --- | --- |
| 固定映射 | 三个策略独立解析；目录排序不改变 key；重复、未知、越界和组合溢出都被识别 |
| 发现 | 正常链路没有 owned-object 扫描或 metadata getter；Registry 空时返回空，旧未登记 Cap 不进入结果 |
| 对象校验 | Cap 类型/owner/accountOwner 正确；同 Cap 或同借贷账户跨策略重复绑定拒绝；对象响应乱序仍正确匹配 |
| 完整性 | 三数组不等长、缺返回值、BCS 异常、对象缺失、RPC 失败不转成成功空仓 |
| metadata 独立性 | 无 name/description 或名称后来被修改，均不影响数字策略解析；仍校验实际市场仓位 |
| 原子登记 | 新建 + 注册 + 开仓整体成功/失败；相同 wallet + key 重复注册 abort；不同钱包使用同一 key 可分别登记 |
| 并发 | 两笔同策略 open 只允许一个登记成功；quote/build 间新增、删除或替换绑定使旧报价失效 |
| 生命周期 | close 后保留 key；空 Cap 可复用；错误记录不自动覆盖或注销 |
| 集成 | cached build 重新核验数字绑定；SDK/API 配置一致；DTO 更新完整；Auto 不进入新分支 |

实施顺序：

1. 在 SDK/API 策略定义中固定编号与版本，完成配置校验和 Registry reader。
2. 替换 Cap 发现与 quote/build 身份绑定，增加原子注册；更新单测、类型检查、构建及模拟脚本。
3. 发布新版 preview SDK 并由 Open API 锁定，更新 HTTP DTO 和前端类型/fixtures。
4. 部署新的 Vercel Preview，验证实际 strategies/positions/quote/build，再更新接入文档中的测试域名和验证记录。
5. 执行前端登记仓位、开仓竞争、关闭后复用及失败恢复回归。

SDK `0.2.0-preview.20261103.1` 已发布到 npm `preview`，Open API 已固定此版本并部署到 [Vercel Preview](https://navi-open-6pzzj8t2y-navi-fd9a1df6.vercel.app)。验证详情见 verification.md；只读模拟不等同钱包签名、真实上链。

## 8. 编写依据

- SDK：`zado/multiply-package`，HEAD `d743a4df2e97ecd89058a70ddb5ca255a30343f8`，当前包 `0.2.0-preview.20261102.2`；分析包含本地未提交源码。
- Open API：`zado/multiply-api-registry`，HEAD `0289733cc8df0e6be96505a7bb860c744996e3ab`；分析包含该 worktree 的本地修改。
- Frontend：`zado/multiply-unified-state-card`，已核对基线 `9f131e9564ee827b33064102cd2d6df8047de700`。
- Registry：[链上反汇编](/Users/zado/.codex/visualizations/2026/11/02/01a19c4c-224f-7492-b1a3-c946094eeae3/multiply-registry-review-2026-11-03/multiply_registry.disassembly.move) 与[只读模拟记录](/Users/zado/.codex/visualizations/2026/11/02/01a19c4c-224f-7492-b1a3-c946094eeae3/multiply-registry-review-2026-11-03/simulation-results.json)。固定数字语义由本文提出，部署前需要落实到同一套策略定义。

同目录 [Address 模式方案](/Users/zado/code/navi/naviprotocol-monorepo/packages/multiply/docs/address-mode-proposal.md) 仍是另一份提案；如未来合并实施，需要统一 ExecutionPlan 的版本和结构。
