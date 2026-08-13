# Vault SDK 设计方案

> 状态：评审稿  
> 目标包：`@naviprotocol/vault`  
> 适用网络：Sui Mainnet  
> 支持环境：`prod`、`test`

## 1. 背景与目标

Volo Vault、NAVI Vault 和 Astros Vault 在底层合约、对象模型、存取款流程上存在差异，但对用户而言都属于 Vault 业务：选择 Vault、存入资产、持有份额、申请提取、取消请求、领取奖励以及查询收益和历史。

Vault SDK 的目标是提供一套业务导向的统一接口，并保留完全本地构建 PTB 的能力，让第三方可以将 Vault 操作与 swap、lending、bridge 等其他 PTB 原子组合。

核心目标：

- 使用统一的 `Vault`、查询接口和 PTB 接口接入 `volo`、`navi`、`astros`。
- PTB 只向调用方传入的 `Transaction` 添加命令，不签名、不执行、不自动设置 gas。
- 所有 PTB 接口最终返回 Sui `TransactionResult`，方便继续组合其他 PTB。
- Vault 配置、协议合约配置和历史数据可以调用后端；当前状态、用户持仓和交易构建尽量查询链上。
- Vault 相关 token amount 统一使用 human-readable decimal string，避免 JavaScript `number` 精度问题。
- 保持与 `frontend-monorepo` 当前 Vault 数据结构的低成本兼容。
- 支持同一条 Sui Mainnet 上的生产合约和测试合约，通过 `env` 区分。
- 新协议通过内部 adapter 扩展，不让协议差异泄露到通用业务接口。

非目标：

- 不支持 Sui testnet、devnet 或 localnet。
- 不提供签名、发送交易和交易确认封装。
- 不通过后端生成 transaction bytes。
- 不允许调用方在 `createVaultSdk` 时注入自定义协议实现。
- V1 不提供 `claimWithdrawnPTB` 通用接口。

## 2. 已确认的设计原则

### 2.1 Mainnet 与环境

SDK 只工作在 Sui Mainnet，不暴露 `network` 参数。

```ts
export type VaultEnv = 'prod' | 'test';
```

- `prod`：Mainnet 上的生产 Vault 合约。
- `test`：Mainnet 上的测试 Vault 合约。

`env` 决定 Vault 列表、协议配置、package ID 和 object ID，但不会改变 RPC 网络。

### 2.2 协议标识

SDK 与现有前端、后端统一使用 `navi`，不引入 `lending` 别名。

```ts
export type VaultProtocol = 'volo' | 'navi' | 'astros';
```

`@naviprotocol/lending` 仍然可以作为 NAVI Lending SDK 的包名，但 Vault 数据中的协议标识固定为 `navi`。

### 2.3 参数风格

公开函数遵循以下规则：

1. 必传业务参数使用位置参数逐个列出。
2. 最后一个参数统一为可选的 `options` 对象。
3. `options` 内所有字段都必须是可选字段。
4. 只有本身属于一个业务判别联合的参数可以使用对象，例如 `WithdrawTarget`。

```ts
withdrawPTB(tx, vault, owner, target, options?);
```

不采用：

```ts
withdrawPTB(tx, {
  vault,
  owner,
  target,
});
```

### 2.4 数值单位

```ts
export type HumanAmount = string;
```

规则如下：

| 数据 | 类型 | 示例 |
|---|---|---|
| Token amount | `HumanAmount` | `'10'`、`'0.125'` |
| Coin decimals | `number` | `9` |
| APR、比例、USD 统计 | `number` | `0.15`、`12.5` |
| Shares、request ID 等链上整数 | `bigint` | `1000000n` |
| Object ID、coin type | `string` | `'0x...'` |
| PTB 中产生的值 | `TransactionResult` | `tx.moveCall(...)` 的结果 |

SDK 负责根据 `VaultToken.decimals` 将 human amount 转成链上整数。SDK 不接受科学计数法，不对超出 token decimals 的输入静默截断。

### 2.5 数据来源

| 能力 | 默认来源 | 原因 |
|---|---|---|
| Vault 列表和详情 | 后端 Vault API | API 直接返回完整 Vault 业务数据和 Vault 级配置 |
| 协议合约配置 | 后端 config 接口 | package/object ID 会随部署升级 |
| APR、TVL、收益历史 | 后端 history 接口 | 依赖历史索引和快照 |
| 当前 Vault 状态 | 链上 | 避免使用过期后端状态 |
| 用户当前持仓 | 链上 | 交易前需要实时数据 |
| 用户 pending request | 链上 | 交易前需要实时对象 |
| PTB 构建 | 本地 | 支持第三方原子组合 |

SDK 不设置 `providers` 抽象。所有后端请求都通过统一 transport，所有链上请求都通过创建 SDK 时传入的 Sui client。

## 3. 包结构

```text
packages/vault/
├── package.json
└── src/
    ├── index.ts
    ├── client.ts
    ├── config/
    │   ├── index.ts
    │   ├── types.ts
    │   └── cache.ts
    ├── vaults/
    │   ├── index.ts
    │   ├── types.ts
    │   └── decoder.ts
    ├── state/
    │   ├── index.ts
    │   └── types.ts
    ├── portfolio/
    │   ├── index.ts
    │   └── types.ts
    ├── history/
    │   ├── index.ts
    │   └── types.ts
    ├── analytics/
    │   ├── index.ts
    │   └── types.ts
    ├── ptb/
    │   ├── index.ts
    │   ├── types.ts
    │   └── options.ts
    ├── protocols/
    │   ├── registry.ts
    │   ├── types.ts
    │   ├── volo/
    │   ├── navi/
    │   └── astros/
    ├── amount/
    ├── transport/
    ├── errors/
    └── types.ts
```

`protocols/registry.ts` 是 SDK 内部注册表，不对调用方暴露协议注入能力。

## 4. SDK 创建与顶层模块

### 4.1 创建 SDK

必传参数使用位置参数，其他行为放入最后的可选 `options`。

```ts
import type { SuiClient } from '@mysten/sui/client';

export interface CreateVaultSdkOptions {
  apiUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  configCacheTime?: number;
  vaultCacheTime?: number;
}

export function createVaultSdk(
  client: SuiClient,
  env: VaultEnv,
  options?: CreateVaultSdkOptions,
): VaultSdk;
```

`CreateVaultSdkOptions` 不包含以下字段：

- `network`：SDK 只支持 Mainnet。
- `providers`：不需要 provider 抽象。
- `protocols`：协议实现由 SDK 内部维护。

### 4.2 顶层对象

```ts
export interface VaultSdk {
  readonly env: VaultEnv;
  readonly client: SuiClient;

  readonly vaults: VaultsModule;
  readonly config: ConfigModule;
  readonly state: VaultStateModule;
  readonly portfolio: PortfolioModule;
  readonly history: HistoryModule;
  readonly analytics: AnalyticsModule;
  readonly ptb: VaultPTBModule;
}
```

## 5. Vault 类型设计

### 5.1 设计依据

`frontend-monorepo` 当前使用以下聚合方式：

```ts
type VoloVault = VoloVaultConfig & VoloVaultData;
```

现有前端由本地静态配置提供 `showName`、token、策略说明和结算展示配置，再与后端 APR、TVL、状态、汇率等动态数据按 Vault ID 合并。

接入 Vault SDK 后，这个聚合过程移到后端。Vault 列表和详情 API 直接返回完整 Vault，SDK 不保存任何 Vault 本地配置，也不按 Vault ID 合并本地数据。SDK 作出以下调整：

- 对外只返回完整 `Vault`，不暴露 `VaultConfig` 和 `getVaultConfig()`。
- 通用业务字段保持扁平，降低现有前端迁移成本。
- 协议特有字段放入 `volo`、`navi`、`astros`。
- UI-only 的 React 组件不进入核心 SDK。
- 无类型的 `dynamicFields` 只作为迁移字段，新增业务必须进入协议类型。
- SDK 只负责 API schema 校验、确定性类型转换和缓存，不补充业务配置。

### 5.2 基础类型

```ts
export interface VaultToken {
  coinType: string;

  /** @deprecated 使用 coinType。为现有前端兼容保留。 */
  type: string;

  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  price?: number;
}

export interface VaultApr {
  value: number;
  incentive?: {
    value: number;
    tokens: VaultToken[];
  };
}

export type VaultStatus =
  | 'pending'
  | 'open'
  | 'lock'
  | 'filled'
  | 'end'
  | 'settling'
  | 'paused';

export interface VaultLockup {
  startAt: string;
  endAt: string;
}

export interface VaultTag {
  name: string;
  color?: string;
  link?: string;
}

export interface VaultAnnouncement {
  content: string;
  startAt?: string;
  endAt?: string;
}

export interface VaultCapabilities {
  deposit: boolean;
  withdraw: boolean;
  cancelDeposit: boolean;
  cancelWithdraw: boolean;
  claimRewards: boolean;
  multiAssetDeposit: boolean;
}
```

状态值继续沿用现有前端和后端的 `lock`、`end`，不在 V1 重命名为 `locked`、`ended`。

### 5.3 策略类型

```ts
export interface VaultStrategyAllocation {
  protocols: string;
  icons?: string[];
  type: string;
  typeLink?: string;
  allocation: string;
  apr: string;
}

export interface VaultStrategyReport {
  label: string;
  links: Array<{
    date: string;
    url?: string;
  }>;
}

export interface VaultStrategy {
  type: string;
  description?: string;
  protocols: string[];
  icons?: string[];

  /** 展示字符串，例如 `20%`。 */
  performanceFee: string;
  performanceFeeTip?: string;
  performanceFeeWaived?: string;
  entryCost: string;
  exitFee?: string;
  borrowFee?: string;
  withdrawFee?: string;

  flowchart?: {
    pc: string;
    mobile: string;
  };

  typeLink?: string;
  naviLink?: string;
  aprName?: string;
  allocations?: VaultStrategyAllocation[];
  reports?: VaultStrategyReport[];

  noVaultAddress?: boolean;
  addressLink?: {
    url: string;
    label: string;
    note?: string;
  };
}
```

费率字段暂时保留前端直接展示的字符串。未来如果业务逻辑需要计算，可以在不破坏兼容性的情况下增加 `performanceFeeRate?: number` 等数值字段。

### 5.4 通用 Vault 字段

```ts
export interface BaseVault<P extends VaultProtocol> {
  /** Vault 链上 object ID，也是 SDK 中的唯一标识。 */
  id: string;
  env: VaultEnv;
  protocol: P;

  /** 后端规范名称。 */
  name: string;

  /** 后端 Vault API 返回的展示名称。 */
  showName: string;
  mobileShowName?: string;

  /** 前端现有分类字段，不代表 Sui coin type。 */
  coinType?: 'btc' | 'stable' | 'prime' | 'sui';

  baseToken: VaultToken;
  stakeTokens: VaultToken[];
  shareCoinType: string;

  strategy: VaultStrategy;
  riskLevel: 'Low' | 'Medium' | 'High';
  riskType?: 'Balanced' | 'Conservative' | 'Strategic';
  capabilities: VaultCapabilities;

  instantAPR: number;
  apy7d: VaultApr;
  apy30d: VaultApr;
  targetApy: number;

  /** 以下字段是 token amount，统一使用 human amount string。 */
  totalStaked: HumanAmount;
  minInvestment: HumanAmount;
  stakeCapAmount?: HumanAmount;
  withdrawLiquidity?: HumanAmount;

  totalStakedUsd: number;
  withdrawLiquidityUsd?: number;
  coinPrice: number;
  exchangeRate: number;

  status: VaultStatus;
  deprecated: boolean;
  startAt?: string;
  endAt?: string;
  lockup?: VaultLockup;

  settlementSchedule?: 'instant' | 'daily' | 'weekly';
  settlementDay?: number;
  settlementDays?: number[];
  settlementMinutes?: number;

  visibleAt?: string;
  isHidden?: boolean;
  isFeatured?: boolean;
  featuredSort?: number;
  unstakePeriod?: boolean;
  hasMultiToken?: boolean;
  isFixedTerm?: boolean;
  isUpgrading?: boolean;
  redemptionLockupDays?: number;

  aprLabel?: 'apr' | 'target-apr';
  apyTip?: string;
  targetApyTip?: string;
  boostTip?: string;
  hideProtection?: boolean;

  tags?: VaultTag[];
  announcement?: VaultAnnouncement | VaultAnnouncement[];

  /**
   * @deprecated 与 id 相同。为现有前端链接逻辑保留，下一大版本移除。
   */
  contractAddress: string;

  /**
   * @deprecated 使用 navi 中的强类型字段。只用于兼容迁移期。
   */
  dynamicFields?: {
    loopBorrowDepth?: number;
    ltv?: number;
    liquidationThreshold?: number;
    managementFee?: number;
    performanceFee?: number;
    paused?: boolean;
  };

  /** 为现有 Multiply Vault UI 保留的兼容入口。 */
  multiply?: {
    supplyAssetId: number;
    borrowAssetId: number;
  };

  /** 与 frontend-monorepo 的 DatabaseRecordMeta 保持兼容。 */
  createdAt: number;
  updatedAt: number;
}
```

`totalShares` 不放入基础 `Vault`。它属于实时链上整数状态，应通过 `getVaultState()` 以 `bigint` 返回，避免破坏前端现有 JSON/Dexie 缓存流程。

### 5.5 协议 Vault 类型

```ts
export interface VoloVaultDetails {
  vaultCode: string;
  receiptParentObjectId?: string;
  rewardManagerObjectId?: string;
  acceptedDepositCoinTypes: string[];
  withdrawHoldPeriodSeconds?: number;
}

export interface NaviVaultMarket {
  code: string;
  poolObjectId: string;
  assetId: number;
  isDefault: boolean;
}

export interface NaviVaultDetails {
  timelockObjectId: string;

  /** Vault wrapper package 允许按 Vault 独立升级时保留在 Vault 中。 */
  initialPackageId?: string;
  packageId?: string;

  priceOracleObjectId?: string;
  markets: NaviVaultMarket[];
  defaultMarket: string;
  rewardRuleIndexes?: number[];

  loopBorrowDepth?: number;
  ltv?: number;
  liquidationThreshold?: number;
}

export interface AstrosVaultDetails {
  vaultCode: string;
  receiptParentObjectId?: string;
  rewardManagerObjectId?: string;
  acceptedDepositCoinTypes: string[];
  withdrawHoldPeriodSeconds?: number;
}

export type VoloVault = BaseVault<'volo'> & {
  volo: VoloVaultDetails;
};

export type NaviVault = BaseVault<'navi'> & {
  navi: NaviVaultDetails;
};

export type AstrosVault = BaseVault<'astros'> & {
  astros: AstrosVaultDetails;
};

export type Vault = VoloVault | NaviVault | AstrosVault;

export interface VaultByProtocol {
  volo: VoloVault;
  navi: NaviVault;
  astros: AstrosVault;
}
```

判别联合允许 TypeScript 自动收窄：

```ts
function getDefaultMarket(vault: Vault) {
  if (vault.protocol !== 'navi') return undefined;
  return vault.navi.defaultMarket;
}
```

### 5.6 用户持仓组合类型

用户持仓不是 Vault 本身的属性，但现有前端会将其注入 `vault.userVaultPosition`。SDK 提供组合类型帮助迁移：

```ts
export interface VaultUserPosition {
  vaultId: string;
  owner: string;

  shares: bigint;
  shareTokenBalance: HumanAmount;
  shareTokenUsd?: number;

  pendingDeposit?: HumanAmount;
  vaultApr?: number;
  lifetimeYield?: HumanAmount;
  lifetimeYieldUsd?: number;
}

export type VaultWithPosition<T extends Vault = Vault> = T & {
  userVaultPosition?: VaultUserPosition | null;
};
```

`getVaults()` 始终返回不依赖钱包地址的 `Vault[]`。前端 store 或 `portfolio.attachPositions()` 负责生成 `VaultWithPosition[]`。

## 6. Vault API 数据契约

Vault API 是完整 `Vault` 的唯一数据来源。后端负责聚合业务元数据、Vault 级合约配置和用于列表展示的动态数据。

```ts
export interface VaultListApiResponse {
  total: number;
  data: Vault[];
  page: number;
  limit: number;
  totalPages: number;
}

export interface VaultDetailApiResponse {
  data: Vault;
}
```

建议接口：

```text
GET /api/v1/vaults?env=prod&protocol=navi&page=1&limit=20
GET /api/v1/vaults/:vaultId?env=prod
```

后端返回要求：

1. 列表项和详情使用相同的 `Vault` 核心结构，详情可以额外增加可选字段，但不能改变同名字段语义。
2. `showName`、token metadata、strategy、settlement、lockup、capabilities 和协议特有字段全部由 API 返回。
3. `volo`、`navi`、`astros` 使用 `protocol` 判别联合；只能出现与当前协议对应的同名字段。
4. Token amount 以十进制 string 返回；API 不使用 JavaScript number 承载 token amount。
5. `contractAddress` 和 `VaultToken.type` 在兼容期由 API 一并返回；若后续移除，需要走 SDK major version。
6. `isHidden`、`visibleAt`、`deprecated` 的过滤由后端根据 query 处理，SDK 不维护本地过滤名单。
7. 后端新增 Vault 不需要发布新版 SDK，只要返回的数据符合当前 schema 即可被 SDK 使用。

SDK 收到响应后只执行：

- 校验必填字段、协议判别字段和 Sui ID/coin type 格式。
- 将 amount 规范化为非科学计数法的十进制 string。
- 将 API 分页结构转换为 `getVaults()` 的 `Vault[]` 返回值。
- 根据 `env` 和请求参数缓存响应。

SDK 不执行：

- 不读取或内置 Vault 静态配置。
- 不覆盖 API 返回的 `lockup`、`startAt`、`endAt`。
- 不为缺失的 strategy、token metadata 或协议 object ID 猜测默认值。
- 不将多个 Vault 数据源合并为一个对象。

API 返回缺少必需业务字段时，SDK 抛出 `API_RESPONSE_INVALID`，而不是返回一个不完整 Vault。

## 7. 协议合约配置

### 7.1 Vault 与 ProtocolConfig 的边界

- `Vault`：某一个 Vault 独有的配置、业务信息和对象 ID。
- `ProtocolConfig`：同一环境下协议共享的 package ID、clock、registry、oracle 等部署配置。

不存在公开的 `VaultConfig` 类型，也不存在：

```ts
sdk.vaults.getVaultConfig(vaultId);
```

### 7.2 配置类型

```ts
export interface BaseProtocolConfig<P extends VaultProtocol> {
  env: VaultEnv;
  protocol: P;

  schemaVersion: number;
  configVersion: string;

  packageId: string;
  initialPackageId: string;
  clockObjectId: string;

  minSdkVersion?: string;
  updatedAt: string;
}

export interface VoloProtocolConfig
  extends BaseProtocolConfig<'volo'> {
  volo: {
    configObjectId: string;
    stakingObjectId: string;
    metadataObjectId?: string;
  };
}

export interface NaviProtocolConfig
  extends BaseProtocolConfig<'navi'> {
  navi: {
    storageObjectId: string;
    incentiveV2ObjectId: string;
    incentiveV3ObjectId: string;
    oraclePackageId: string;
    oracleConfigObjectId: string;
    priceOracleObjectId: string;
    suiSystemStateObjectId?: string;
  };
}

export interface AstrosProtocolConfig
  extends BaseProtocolConfig<'astros'> {
  astros: {
    configObjectId: string;
    routerObjectId: string;
    registryObjectId?: string;
  };
}

export type ProtocolConfig =
  | VoloProtocolConfig
  | NaviProtocolConfig
  | AstrosProtocolConfig;

export interface ProtocolConfigMap {
  volo: VoloProtocolConfig;
  navi: NaviProtocolConfig;
  astros: AstrosProtocolConfig;
}
```

字段归属原则：如果一个 package/object 在同一协议的不同 Vault 之间共享，放在 `ProtocolConfig`；如果不同 Vault 可能使用不同版本或对象，放在对应的 `Vault` 协议字段中。

### 7.3 配置接口

```ts
export interface GetConfigOptions {
  disableCache?: boolean;
  cacheTime?: number;
}

export interface GetConfigsOptions {
  protocols?: VaultProtocol[];
  disableCache?: boolean;
  cacheTime?: number;
}

export interface ConfigModule {
  getConfig<P extends VaultProtocol>(
    protocol: P,
    options?: GetConfigOptions,
  ): Promise<ProtocolConfigMap[P]>;

  getConfigs(
    options?: GetConfigsOptions,
  ): Promise<ProtocolConfig[]>;
}
```

建议后端接口：

```text
GET /api/v1/protocol-configs?env=prod
GET /api/v1/protocol-configs/volo?env=prod
GET /api/v1/protocol-configs/navi?env=prod
GET /api/v1/protocol-configs/astros?env=prod
```

默认缓存 key：

```text
vault-protocol-config:${env}:${protocol}:${configVersion}
```

SDK 对相同缓存 key 的并发请求进行 singleton 去重，默认缓存时间建议为 5 分钟。

## 8. Vault 查询接口

```ts
export type VaultIdentifier = string | Vault;

export interface GetVaultOptions {
  disableCache?: boolean;
  cacheTime?: number;
  includeHidden?: boolean;
}

export interface GetVaultsOptions extends GetVaultOptions {
  protocols?: VaultProtocol[];
  includeDeprecated?: boolean;
}

export interface VaultsModule {
  getVault(
    vaultId: string,
    options?: GetVaultOptions,
  ): Promise<Vault>;

  getVaults(
    options?: GetVaultsOptions,
  ): Promise<Vault[]>;
}
```

`getVault()` 和 `getVaults()` 直接返回后端 API 提供的完整 Vault。SDK 不读取本地 Vault 配置，也不要求前端再次合并静态数据。

## 9. 链上状态与 Portfolio

### 9.1 Vault 状态

```ts
export interface VaultState {
  vaultId: string;

  totalAssets: HumanAmount;
  totalShares: bigint;
  sharePrice: number;
  availableLiquidity?: HumanAmount;

  paused: boolean;
  defaultMarket?: string;
  observedAt: string;
}

export interface GetVaultStateOptions {
  config?: ProtocolConfig;
}

export interface VaultStateModule {
  getVaultState(
    vault: VaultIdentifier,
    options?: GetVaultStateOptions,
  ): Promise<VaultState>;
}
```

### 9.2 用户持仓与请求

```ts
export interface VaultRequest {
  vaultId: string;
  owner: string;
  requestId: bigint;
  receiptObjectId: string;
  kind: 'deposit' | 'withdraw';
  status: 'pending' | 'cancelled' | 'executed';
  amount: HumanAmount;
  shares?: bigint;
  executeAt?: string;
}

export interface GetPositionOptions {
  config?: ProtocolConfig;
}

export interface GetPositionsOptions {
  protocols?: VaultProtocol[];
  configs?: Partial<ProtocolConfigMap>;
}

export interface GetRequestsOptions {
  kinds?: Array<'deposit' | 'withdraw'>;
  config?: ProtocolConfig;
}

export interface PortfolioModule {
  getPosition(
    vault: VaultIdentifier,
    owner: string,
    options?: GetPositionOptions,
  ): Promise<VaultUserPosition | null>;

  getPositions(
    owner: string,
    options?: GetPositionsOptions,
  ): Promise<VaultUserPosition[]>;

  getRequests(
    vault: VaultIdentifier,
    owner: string,
    options?: GetRequestsOptions,
  ): Promise<VaultRequest[]>;

  attachPositions(
    vaults: Vault[],
    positions: VaultUserPosition[],
  ): VaultWithPosition[];
}
```

以上接口默认直接查询链上。`attachPositions()` 是同步纯函数，不发起请求。

## 10. 历史与统计接口

历史数据依赖后端索引，不尝试通过前端扫描事件重建。

```ts
export interface HistoryQueryOptions {
  startAt?: string;
  endAt?: string;
  interval?: 'hour' | 'day' | 'week';
  cursor?: string;
  limit?: number;
}

export interface VaultHistoryPoint {
  timestamp: string;
  value: number;
}

export interface VaultTransactionHistoryItem {
  digest: string;
  vaultId: string;
  owner: string;
  type: 'deposit' | 'withdraw' | 'cancel-deposit' | 'cancel-withdraw' | 'claim';
  amount?: HumanAmount;
  shares?: bigint;
  timestamp: string;
}

export interface GetTransactionsOptions {
  vaultId?: string;
  protocols?: VaultProtocol[];
  cursor?: string;
  limit?: number;
}

export interface HistoryModule {
  getApyHistory(
    vault: VaultIdentifier,
    options?: HistoryQueryOptions,
  ): Promise<VaultHistoryPoint[]>;

  getTvlHistory(
    vault: VaultIdentifier,
    options?: HistoryQueryOptions,
  ): Promise<VaultHistoryPoint[]>;

  getRevenueHistory(
    vault: VaultIdentifier,
    options?: HistoryQueryOptions,
  ): Promise<VaultHistoryPoint[]>;

  getSharePriceHistory(
    vault: VaultIdentifier,
    options?: HistoryQueryOptions,
  ): Promise<VaultHistoryPoint[]>;

  getTransactions(
    owner: string,
    options?: GetTransactionsOptions,
  ): Promise<{
    data: VaultTransactionHistoryItem[];
    cursor?: string;
  }>;
}

export interface AnalyticsOptions {
  protocols?: VaultProtocol[];
}

export interface VaultAnalyticsSummary {
  totalTvlUsd: number;
  totalRevenueUsd: number;
  vaultCount: number;
}

export interface AnalyticsModule {
  getSummary(
    options?: AnalyticsOptions,
  ): Promise<VaultAnalyticsSummary>;
}
```

## 11. PTB 公共接口

### 11.1 通用约定

- 调用方创建并持有 `Transaction`。
- SDK 只追加 Move call、coin split/merge 和必要的 oracle update。
- SDK 不调用 `signAndExecuteTransaction`。
- SDK 不自动 transfer 返回对象。
- 公共 PTB 因为可能异步加载 Vault、config 和链上对象，所以函数签名是 `Promise<TransactionResult>`；Promise resolve 后的业务返回值严格是 `TransactionResult`，不使用自定义 response wrapper。
- 如果传入完整 `Vault`，SDK 不再请求单个 Vault；仍会读取缓存或请求对应 `ProtocolConfig`。

### 11.2 WithdrawTarget

`withdrawPTB` 合并按 amount、按 shares 和全部提取三种接口。

```ts
import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult,
} from '@mysten/sui/transactions';

export type WithdrawTarget =
  | {
      kind: 'amount';
      amount: HumanAmount;
    }
  | {
      kind: 'shares';
      shares: bigint | TransactionResult;
    }
  | {
      kind: 'all';
    };
```

### 11.3 Options

```ts
export interface BasePTBOptions {
  /** 高级调用方可以预加载并复用；不传时 SDK 自动获取。 */
  config?: ProtocolConfig;

  /** 仅作为业务来源标记写入支持该能力的合约或事件。 */
  source?: string;
}

export interface DepositPTBOptions extends BasePTBOptions {
  /** 多资产 Vault 的存入币种；默认使用 vault.baseToken.coinType。 */
  coinType?: string;

  /**
   * 已存在于当前 PTB 的 Coin，例如 swap 的输出。
   * 不传时 SDK 查询 owner 的链上 Coin 并在本地 PTB 中组合。
   */
  coin?: TransactionObjectArgument;

  /** 存入 SUI 时是否允许从 gas coin split。 */
  useGasCoin?: boolean;
}

export interface WithdrawPTBOptions extends BasePTBOptions {
  /** NAVI Vault 存在 pending deposit 时是否先取消。 */
  cancelPendingDeposit?: boolean;
}

export interface CancelPTBOptions extends BasePTBOptions {}

export interface ClaimRewardsPTBOptions extends BasePTBOptions {
  /** 已知 reward coin 对象可以在组合场景中直接传入。 */
  coin?: TransactionObjectArgument;
}
```

### 11.4 方法定义

```ts
export interface VaultPTBModule {
  depositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    amount: HumanAmount,
    options?: DepositPTBOptions,
  ): Promise<TransactionResult>;

  withdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions,
  ): Promise<TransactionResult>;

  cancelDepositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: bigint,
    receipt: string | TransactionObjectArgument,
    options?: CancelPTBOptions,
  ): Promise<TransactionResult>;

  cancelWithdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    requestId: bigint,
    receipt: string | TransactionObjectArgument,
    options?: CancelPTBOptions,
  ): Promise<TransactionResult>;

  claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    rewardCoinType: string,
    options?: ClaimRewardsPTBOptions,
  ): Promise<TransactionResult>;
}
```

`claimRewardsPTB` 每次指定一种 `rewardCoinType`，SDK 将同币种奖励合并为单个 Coin result，保证返回一个 `TransactionResult`。

`claimWithdrawnPTB` 不进入 V1 通用接口。若未来某协议确实要求独立 claim 阶段，应先通过 `VaultCapabilities` 表达，再新增明确的通用业务方法，而不是把协议内部结算步骤直接暴露出来。

### 11.5 PTB 内部执行流程

```text
Vault ID 或 Vault
        │
        ▼
解析完整 Vault
        │ vault.protocol
        ▼
读取并缓存 ProtocolConfig
        │
        ▼
校验 env / protocol / configVersion
        │
        ▼
protocols/registry 选择 adapter
        │
        ▼
必要的链上查询和 oracle update
        │
        ▼
向调用方 Transaction 添加命令
        │
        ▼
返回 TransactionResult
```

## 12. 协议 Adapter

通用 PTB 完成 Vault/config 解析和协议路由，协议目录实现具体 Move 调用。

```ts
export interface ProtocolPTB<
  TVault extends Vault,
  TConfig extends ProtocolConfig,
> {
  depositPTB(
    tx: Transaction,
    vault: TVault,
    config: TConfig,
    owner: string,
    amount: HumanAmount,
    options?: DepositPTBOptions,
  ): Promise<TransactionResult>;

  withdrawPTB(
    tx: Transaction,
    vault: TVault,
    config: TConfig,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions,
  ): Promise<TransactionResult>;

  cancelDepositPTB(
    tx: Transaction,
    vault: TVault,
    config: TConfig,
    owner: string,
    requestId: bigint,
    receipt: string | TransactionObjectArgument,
    options?: CancelPTBOptions,
  ): Promise<TransactionResult>;

  cancelWithdrawPTB(
    tx: Transaction,
    vault: TVault,
    config: TConfig,
    owner: string,
    requestId: bigint,
    receipt: string | TransactionObjectArgument,
    options?: CancelPTBOptions,
  ): Promise<TransactionResult>;

  claimRewardsPTB(
    tx: Transaction,
    vault: TVault,
    config: TConfig,
    owner: string,
    rewardCoinType: string,
    options?: ClaimRewardsPTBOptions,
  ): Promise<TransactionResult>;
}
```

内部 registry 是穷举映射：

```ts
const protocolRegistry = {
  volo: voloProtocol,
  navi: naviProtocol,
  astros: astrosProtocol,
} satisfies ProtocolRegistry;
```

新增协议时必须完成：

1. 扩展 `VaultProtocol`。
2. 新增协议 Vault 判别联合成员。
3. 新增协议 config 判别联合成员。
4. 实现 `ProtocolPTB`。
5. 注册 adapter。
6. 添加 contract fixture、PTB snapshot/dry-run 和前端兼容测试。

## 13. Config 校验与降级

PTB 构建前必须校验：

```ts
config.env === sdk.env;
config.protocol === vault.protocol;
```

同时校验：

- `schemaVersion` 是否被当前 SDK 支持。
- `minSdkVersion` 是否高于当前 SDK。
- package ID 和关键 object ID 是否为合法 Sui ID。
- Vault 所需的协议字段是否存在。

Config API 不可用时：

1. 优先使用尚未过期的内存缓存。
2. 调用方可以通过 `options.config` 传入预加载配置。
3. 没有合法配置时抛出 `ProtocolConfigUnavailableError`，不猜测 package/object ID。

SDK 不将过期配置永久写入浏览器 storage；需要持久化时由应用自行管理并通过 `options.config` 传入。

## 14. 错误模型

```ts
export type VaultSdkErrorCode =
  | 'VAULT_NOT_FOUND'
  | 'VAULT_UNSUPPORTED'
  | 'PROTOCOL_CONFIG_UNAVAILABLE'
  | 'PROTOCOL_CONFIG_MISMATCH'
  | 'UNSUPPORTED_CONFIG_VERSION'
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_BALANCE'
  | 'UNSUPPORTED_DEPOSIT_ASSET'
  | 'OPERATION_NOT_SUPPORTED'
  | 'REQUEST_NOT_FOUND'
  | 'CHAIN_QUERY_FAILED'
  | 'API_RESPONSE_INVALID'
  | 'API_REQUEST_FAILED';

export class VaultSdkError extends Error {
  readonly code: VaultSdkErrorCode;
  readonly cause?: unknown;
}
```

公开方法不返回 `{ success: false }`。失败统一抛出可识别的 `VaultSdkError`。

## 15. 业务场景用例

以下示例省略钱包连接细节，假设 `signer` 已由应用提供。

### 15.1 初始化生产环境 SDK

```ts
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { createVaultSdk } from '@naviprotocol/vault';

const client = new SuiClient({
  url: getFullnodeUrl('mainnet'),
});

const vaultSdk = createVaultSdk(client, 'prod');
```

业务含义：连接 Mainnet 上的生产 Vault 合约。SDK 会自动在后端请求中携带 `env=prod`。

### 15.2 初始化 Mainnet 测试合约环境

```ts
const testVaultSdk = createVaultSdk(client, 'test');
```

业务含义：RPC 仍然是 Mainnet，但 Vault 列表和协议配置指向 Mainnet 上的测试部署。

### 15.3 前端获取完整 Vault 列表

```ts
const vaults = await vaultSdk.vaults.getVaults({
  protocols: ['volo', 'navi', 'astros'],
});

for (const vault of vaults) {
  console.log(
    vault.showName,
    vault.baseToken.symbol,
    vault.instantAPR,
    vault.totalStakedUsd,
  );
}
```

业务含义：后端 API 直接返回完整 Vault，SDK 完成 schema 校验和缓存。前端不再维护 `voloVaults`，也不再手动 `{ ...config, ...data }`。

### 15.4 获取单个 Vault 并访问协议字段

```ts
const vault = await vaultSdk.vaults.getVault(vaultId);

switch (vault.protocol) {
  case 'volo':
    console.log(vault.volo.vaultCode);
    break;
  case 'navi':
    console.log(vault.navi.defaultMarket);
    break;
  case 'astros':
    console.log(vault.astros.vaultCode);
    break;
}
```

业务含义：通用页面使用扁平公共字段，协议详情页通过判别联合安全读取协议特有字段。

### 15.5 查询用户实时持仓并附加到前端列表

```ts
const [vaults, positions] = await Promise.all([
  vaultSdk.vaults.getVaults(),
  vaultSdk.portfolio.getPositions(owner),
]);

const vaultsWithPosition = vaultSdk.portfolio.attachPositions(
  vaults,
  positions,
);
```

业务含义：Vault 列表可以跨用户缓存；钱包相关持仓单独从链上读取，避免把用户状态写进公共 Vault 缓存。

### 15.6 普通存款

```ts
import { Transaction } from '@mysten/sui/transactions';

const tx = new Transaction();

const depositResult = await vaultSdk.ptb.depositPTB(
  tx,
  vault,
  owner,
  '10.5',
);

// depositResult 是 TransactionResult，可以继续传给同一个 PTB 中的操作。
void depositResult;

const response = await client.signAndExecuteTransaction({
  transaction: tx,
  signer,
});
```

业务含义：SDK 从链上选择 owner 的 Coin，按 token decimals 将 `'10.5'` 转换为最小单位，并在本地构建 PTB。

### 15.7 将 swap 输出直接存入 Vault

```ts
const tx = new Transaction();

const swappedCoin = await swapPTB(
  tx,
  inputCoin,
  outputCoinType,
  '100',
);

const depositResult = await vaultSdk.ptb.depositPTB(
  tx,
  vault,
  owner,
  '99.5',
  {
    coin: swappedCoin,
    coinType: outputCoinType,
  },
);

await anotherComposablePTB(tx, depositResult);
```

业务含义：整个 swap → deposit → 后续操作在一个 PTB 中原子执行，Vault SDK 不要求 swap 结果先转入钱包。

### 15.8 按人类可读 amount 提取

```ts
const tx = new Transaction();

const result = await vaultSdk.ptb.withdrawPTB(
  tx,
  vault,
  owner,
  {
    kind: 'amount',
    amount: '10',
  },
);
```

适用于用户输入“提取 10 USDC”一类业务场景。SDK 根据当前 share price 或协议规则换算所需 shares。

### 15.9 按 shares 提取

```ts
const tx = new Transaction();

const result = await vaultSdk.ptb.withdrawPTB(
  tx,
  vault,
  owner,
  {
    kind: 'shares',
    shares: 1_000_000n,
  },
);
```

也可以传入当前 PTB 中产生的 shares：

```ts
const result = await vaultSdk.ptb.withdrawPTB(
  tx,
  vault,
  owner,
  {
    kind: 'shares',
    shares: sharesResult,
  },
);
```

### 15.10 全部提取

```ts
const tx = new Transaction();

const result = await vaultSdk.ptb.withdrawPTB(
  tx,
  vault,
  owner,
  {
    kind: 'all',
  },
);
```

SDK 查询用户链上持仓并使用协议对应的全部提取流程，不需要单独的 `withdrawAllPTB()`。

### 15.11 NAVI Vault 提取并更新 Oracle

```ts
const tx = new Transaction();

const result = await vaultSdk.ptb.withdrawPTB(
  tx,
  naviVault,
  owner,
  {
    kind: 'amount',
    amount: '250',
  },
);
```

业务含义：NAVI adapter 根据链上 Vault 状态解析当前 default market，并在 withdraw 前强制插入必要的 oracle price update。调用方不需要理解 NAVI 的 market 参数，也不能意外关闭价格更新。

### 15.12 取消 pending deposit

```ts
const requests = await vaultSdk.portfolio.getRequests(vault, owner, {
  kinds: ['deposit'],
});

const request = requests[0];
if (!request) throw new Error('No pending deposit request');

const tx = new Transaction();

const returnedCoin = await vaultSdk.ptb.cancelDepositPTB(
  tx,
  vault,
  owner,
  request.requestId,
  request.receiptObjectId,
);

tx.transferObjects([returnedCoin], owner);
```

业务含义：SDK 返回可组合的 `TransactionResult`，由调用方决定转账、swap 或存入其他协议。

### 15.13 取消 pending withdraw

```ts
const requests = await vaultSdk.portfolio.getRequests(vault, owner, {
  kinds: ['withdraw'],
});

const request = requests[0];
if (!request) throw new Error('No pending withdraw request');

const tx = new Transaction();

const result = await vaultSdk.ptb.cancelWithdrawPTB(
  tx,
  vault,
  owner,
  request.requestId,
  request.receiptObjectId,
);
```

### 15.14 领取单一奖励币并继续组合

```ts
const tx = new Transaction();

const rewardCoin = await vaultSdk.ptb.claimRewardsPTB(
  tx,
  vault,
  owner,
  rewardCoinType,
);

const swappedReward = await swapPTB(
  tx,
  rewardCoin,
  vault.baseToken.coinType,
  claimableRewardAmount,
);

await vaultSdk.ptb.depositPTB(
  tx,
  vault,
  owner,
  expectedRewardAmount,
  {
    coin: swappedReward,
  },
);
```

业务含义：claim → swap → compound 在同一交易中完成。实际可存入 amount 应由调用方根据 quote 或 PTB 业务能力确定。

### 15.15 预加载配置并复用

```ts
const config = await vaultSdk.config.getConfig(firstVault.protocol);
const tx = new Transaction();

const first = await vaultSdk.ptb.depositPTB(
  tx,
  firstVault,
  owner,
  '10',
  { config },
);

const second = await vaultSdk.ptb.depositPTB(
  tx,
  secondVault,
  owner,
  '20',
  { config },
);

void first;
void second;
```

业务含义：`firstVault` 和 `secondVault` 属于同一个协议。高级集成方可以显式预加载并复用协议 config，避免多个操作重复访问配置接口。SDK 仍会校验 config 的 `env` 和 `protocol`。

### 15.16 获取 APR 和 TVL 历史用于图表

```ts
const [apy, tvl] = await Promise.all([
  vaultSdk.history.getApyHistory(vault, {
    startAt: '2026-07-01T00:00:00Z',
    endAt: '2026-08-01T00:00:00Z',
    interval: 'day',
  }),
  vaultSdk.history.getTvlHistory(vault, {
    startAt: '2026-07-01T00:00:00Z',
    endAt: '2026-08-01T00:00:00Z',
    interval: 'day',
  }),
]);
```

业务含义：历史查询使用后端快照；不影响 PTB 和实时持仓继续使用链上数据。

## 16. frontend-monorepo 接入方案

### 16.1 可以直接保留的字段访问

以下现有写法继续成立：

```ts
vault.id;
vault.name;
vault.showName;
vault.baseToken;
vault.stakeTokens;
vault.strategy.performanceFee;
vault.instantAPR;
vault.apy7d;
vault.apy30d;
vault.totalStaked;
vault.totalStakedUsd;
vault.minInvestment;
vault.stakeCapAmount;
vault.exchangeRate;
vault.targetApy;
vault.status;
vault.lockup;
vault.settlementSchedule;
vault.settlementDay;
vault.settlementDays;
```

协议判断也继续使用：

```ts
vault.protocol === 'navi';
```

### 16.2 必须调整的部分

#### Amount 从 number 改为 string

```ts
new BigNumber(vault.totalStaked);
new BigNumber(vault.minInvestment);
new BigNumber(vault.stakeCapAmount ?? '0');
```

禁止直接：

```ts
vault.stakeCapAmount - vault.totalStaked;
```

#### 用户持仓使用组合类型

当前前端 store 可以继续注入 position，但类型改为：

```ts
VaultWithPosition
```

#### UI-only 内容留在前端

ReactNode、组件、国际化函数等不能进入核心 SDK。确有需要时，前端按 Vault ID 维护 UI extension：

```ts
interface VaultUiExtension {
  apyTip?: React.ReactNode;
  performanceFeeTip?: React.ReactNode;
}

const vaultUiExtensions: Record<string, VaultUiExtension> = {};
```

### 16.3 建议迁移顺序

1. 后端 Vault 列表和详情接口补齐当前前端使用的展示、策略、token、结算和协议字段。
2. 对 `prod`、`test` 两套 API 响应执行 schema 和页面回归验证。
3. 在 `frontend-monorepo` 引入 `@naviprotocol/vault` 类型。
4. 将 `getVoloVault()`、`getVoloVaults()` 替换为 `sdk.vaults`。
5. 保留现有 store/hook，先只替换数据来源。
6. 将 amount 数学运算统一改成 `BigNumber`。
7. 将 position 注入类型改为 `VaultWithPosition`。
8. 最后删除前端重复的 Vault 类型、静态配置和合并函数。

## 17. 缓存策略

| 数据 | 默认缓存 | 说明 |
|---|---:|---|
| ProtocolConfig | 5 分钟 | 支持 `disableCache` 和 `cacheTime` |
| Vault 列表/详情 | 1 分钟 | 包含后端动态统计 |
| 当前 VaultState | 不缓存 | 交易前实时查询链上 |
| 用户 Position/Request | 不缓存 | 钱包状态要求实时 |
| 历史数据 | 5 分钟 | 相同查询条件可复用 |

缓存仅用于减少重复请求，不作为交易正确性的唯一数据源。PTB adapter 在需要时仍应读取关键链上状态。

## 18. 测试与验收

### 18.1 类型测试

- `vault.protocol === 'navi'` 后可以访问 `vault.navi`。
- `volo` Vault 不能访问 `vault.navi`。
- 所有公开函数的必传参数都是位置参数。
- 所有公开函数最后一个参数都是可选 options，且 options 字段全部可选。
- 所有 PTB resolve value 都是 `TransactionResult`。

### 18.2 Amount 测试

- 支持 `'0'`、`'1'`、`'0.000001'`。
- 拒绝负数、空字符串、科学计数法和非法字符。
- 超出 decimals 的小数位直接报错。
- 大额 amount 不经过 JavaScript `number`。

### 18.3 Config 测试

- `prod` SDK 拒绝 `test` config。
- `volo` Vault 拒绝 `navi` config。
- 并发 `getConfig('navi')` 只触发一次网络请求。
- `disableCache: true` 强制刷新。
- API 失败时可以使用调用方传入的合法 config。

### 18.4 PTB 测试

每个协议至少覆盖：

- deposit。
- withdraw by amount。
- withdraw by shares。
- withdraw all。
- cancel deposit。
- cancel withdraw。
- claim rewards。
- 外部 Coin `TransactionResult` 组合。
- config env/protocol 不匹配。
- Mainnet `prod` 和 Mainnet `test` dry-run。

NAVI withdraw 额外验证 oracle update 顺序和 default market 解析。

### 18.5 前端兼容测试

- 用 SDK `Vault` 编译 `packages/vault-ui` 的核心组件。
- 验证 `JSON.stringify(Vault)` 不包含 bigint。
- 验证 Dexie 可以保存 `Vault`。
- 验证 API 返回的 `lockup/startAt/endAt` 与现有页面行为一致。
- 验证后端新增 Vault 无需更新 SDK 即可出现在列表和详情中。
- 验证 API 缺少必填展示或协议字段时 SDK 抛出 `API_RESPONSE_INVALID`。

## 19. V1 最终决策汇总

| 议题 | 决策 |
|---|---|
| 网络 | 只支持 Sui Mainnet |
| 合约环境 | `prod`、`test` |
| 协议标识 | `volo`、`navi`、`astros` |
| `lending` 标识 | 不使用 |
| Provider 抽象 | 不使用 |
| 协议注入 | 不开放 |
| Vault 数据来源 | 列表和详情完全由后端 API 返回，SDK 无本地 Vault 配置 |
| VaultConfig | 字段由后端合并进 Vault 响应，移除公开类型和独立接口 |
| ProtocolConfig | 独立模块，通过统一后端获取 |
| Config 个性字段 | 放入 `volo`、`navi`、`astros` |
| PTB 构建 | 完全本地 |
| PTB 返回值 | `Promise<TransactionResult>` |
| Amount | human-readable decimal string |
| Withdraw | amount/shares/all 合并为一个判别联合接口 |
| `claimWithdrawnPTB` | V1 不提供 |
| 当前状态与持仓 | 优先链上查询 |
| 历史数据 | 后端查询 |
| 前端兼容 | 公共字段扁平；协议字段嵌套；保留少量 deprecated alias |
