# Vault SDK 设计方案

> 状态：基础框架
>
> 目标包：`@naviprotocol/vault`
>
> 方案来源：[Vault SDK Notion 文档](https://www.notion.so/naviprotocol/3c0b32739dc3800abb1ece4bad038360)

## 1. 目标与范围

Vault SDK 为 NAVI Lending Vault 和 Volo Vault 提供统一的数据模型、查询接口和 PTB
构建接口。当前阶段只搭建模块、接口与类型，不实现 API 请求、链上查询和交易构建逻辑。

设计边界如下：

- `Vault` 只保存 SDK 内部查询和 PTB 路由所需的数据。
- 后端把不同业务来源转换成统一的 `Vault` 数据。
- `app` 表示 Vault 所属产品，`protocol` 表示合约协议实现。
- 合约配置直接放在 `Vault.contractConfig` 中，不提供 `getConfig()`。
- 用户查询和 PTB 操作统一放在 `user` 模块。
- 不提供独立的 `portfolio`、`ptb`、`state`、`history` 或 `analytics` 顶层模块。
- PTB 的协议差异收敛在内部 `protocols` 模块。

## 2. 基础类型

```ts
export type VaultEnv = 'prod' | 'test'
export type VaultApp = 'navi' | 'volo' | 'astros'
export type VaultProtocol = 'navi-lending' | 'volo-vault'

export type DecimalString = string
export type IntegerString = string
export type HumanAmount = DecimalString
```

`VaultApp` 与 `VaultProtocol` 的职责不同：

- `app` 用于业务归属和查询过滤。
- `protocol` 用于选择协议对应的 PTB 实现。

## 3. Vault 模型

### 3.1 资产

```ts
export interface VaultAsset {
  coinType: string
  decimals: number
}

export interface VaultAssets {
  base: VaultAsset
  deposits: VaultAsset[]
}
```

资产类型只保留金额换算和交易构建所需的 `coinType` 与 `decimals`。名称、图标、价格、
APR 和 TVL 等展示或业务数据不属于 SDK 的最小 `Vault` 定义。

### 3.2 合约配置

```ts
export interface BaseVaultContractConfig {
  env: VaultEnv
  schemaVersion: number
  package: string
  initialPackageId: string
  clockObjectId: string
  minSdkVersion?: string
}
```

NAVI Lending 的协议配置：

```ts
export interface NAVILendingMarket {
  code: string
  poolObjectId: string
  storageObjectId: string
  assetId: number
  incentiveV2ObjectId: string
  incentiveV3ObjectId: string
}

export interface NAVILendingRewardRule {
  ruleIndex: number
  rewardCoinType: string
  active: boolean
}

export interface NAVILendingContractConfig extends BaseVaultContractConfig {
  naviLending: {
    timelockObjectId: string
    oraclePackageId: string
    oracleConfigObjectId: string
    priceOracleObjectId: string
    suiSystemStateObjectId?: string
    markets: NAVILendingMarket[]
    defaultMarketCode: string
    rewardRules: NAVILendingRewardRule[]
  }
}
```

Volo Vault 的协议配置：

```ts
export interface ReceiptBasedVaultContractConfig {
  vaultCode: string
  receiptParentObjectId?: string
  rewardManagerObjectId?: string
}

export interface VoloVaultContractConfig extends BaseVaultContractConfig {
  volo: ReceiptBasedVaultContractConfig & {
    configObjectId: string
    stakingObjectId: string
    metadataObjectId?: string
  }
}
```

### 3.3 最小 Vault

```ts
export interface VaultContractConfigMap {
  'navi-lending': NAVILendingContractConfig
  'volo-vault': VoloVaultContractConfig
}

export interface BaseVault<P extends VaultProtocol, C extends VaultContractConfigMap[P]> {
  id: string
  app: VaultApp
  protocol: P
  contractConfig: C
  assets: VaultAssets
}

export type NAVILendingVault = BaseVault<'navi-lending', NAVILendingContractConfig>
export type VoloVault = BaseVault<'volo-vault', VoloVaultContractConfig>
export type Vault = NAVILendingVault | VoloVault
export type VaultIdentifier = string | Vault
```

`Vault` 使用 `protocol` 作为判别字段。调用方判断 `vault.protocol` 后，可以安全访问对应的
`contractConfig`，不需要类型断言。

## 4. SDK 顶层接口

```ts
export interface CreateVaultSdkOptions {
  apiUrl?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
  vaultCacheTime?: number
}

export interface VaultSdk {
  readonly env: VaultEnv
  readonly client: VaultSuiClient
  readonly vaults: VaultsModule
  readonly user: UserModule
}

export function createVaultSdk(
  client: VaultSuiClient,
  env: VaultEnv,
  options?: CreateVaultSdkOptions
): VaultSdk
```

## 5. Vault 模块

```ts
export interface GetVaultOptions {
  disableCache?: boolean
  cacheTime?: number
}

export interface GetVaultsOptions extends GetVaultOptions {
  app: VaultApp[]
}

export interface VaultsModule {
  getVault(vaultId: string, options?: GetVaultOptions): Promise<Vault>
  getVaults(options?: GetVaultsOptions): Promise<Vault[]>
}
```

- `getVault` 按 ID 返回一个 Vault；不存在时抛出 `VaultSdkError`（code 为 `VAULT_NOT_FOUND`）。
- `getVaults` 返回 Vault 列表，可按一个或多个 `app` 过滤。
- `disableCache` 用于跳过缓存。
- `cacheTime` 用于覆盖单次查询的缓存时间。

## 6. User 模块

### 6.1 持仓查询

```ts
export interface VaultUserPosition {
  vaultId: string
  owner: string
  shares: IntegerString
  amount: HumanAmount
  amountUsd?: number
}

export interface GetPositionsOptions {
  app?: VaultApp[]
}
```

Notion 方案没有展开 `GetPositionsOptions`。当前框架只保留与 Vault 列表一致的可选 `app`
过滤，后续以统一后端接口为准扩展。

### 6.2 存取款参数

```ts
export interface DepositPTBOptions {
  coinType?: string
  coin?: TransactionObjectArgument
  useGasCoin?: boolean
}

export type DepositAmount = HumanAmount | TransactionArgument | TransactionResult

export interface DepositPTBResult {
  receipt: TransactionResult
  shares?: TransactionResult
  requestId?: TransactionResult
}

export interface WithdrawPTBOptions {
  cancelPendingDeposit?: boolean
}

export type WithdrawTarget =
  | { kind: 'amount'; amount: HumanAmount }
  | { kind: 'shares'; shares: IntegerString | TransactionResult }
  | { kind: 'all' }
```

### 6.3 公共接口

```ts
export interface UserModule {
  getPosition(vault: VaultIdentifier, owner: string): Promise<VaultUserPosition | null>

  getPositions(owner: string, options?: GetPositionsOptions): Promise<VaultUserPosition[]>

  depositPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    amount: DepositAmount,
    options?: DepositPTBOptions
  ): Promise<DepositPTBResult>

  withdrawPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
  ): Promise<TransactionResult>

  cancelPendingDepositPTB(tx: Transaction, request: PendingRequest): Promise<TransactionResult>

  cancelPendingWithdrawPTB(tx: Transaction, request: PendingRequest): Promise<TransactionResult>

  claimRewardsPTB(
    tx: Transaction,
    vault: VaultIdentifier,
    owner: string
  ): Promise<TransactionResult>
}
```

`portfolio` 模块和独立 `ptb` 模块不再存在。持仓查询与交易构建统一通过 `sdk.user` 调用。

`depositPTB` 接受人类可读金额字符串，也接受同一 PTB 中产生的原始金额参数。传入
`TransactionArgument` 或 `TransactionResult` 时必须同时提供 `options.coin`。返回值统一为对象：
NAVI 返回 `receipt` 和 `shares`，Volo 返回 `receipt` 和 `requestId`。顶层接口会自动把 receipt
以及 Volo 返回的 charge coin 转给 `owner`，调用方不能再次消费返回的 `receipt`。

## 7. Protocols 模块

不同合约的 PTB 构建逻辑按协议拆分：

```text
src/protocols/
├── index.ts
├── registry.ts
├── types.ts
├── unsupported.ts
├── navi-lending/
│   └── ptb.ts
└── volo-vault/
    └── ptb.ts
```

内部注册表以 `VaultProtocol` 路由：

```ts
export interface ProtocolRegistry {
  'navi-lending': ProtocolPTB<NAVILendingVault>
  'volo-vault': ProtocolPTB<VoloVault>
}
```

`sdk.user` 的公共 PTB 方法负责解析 `VaultIdentifier`，然后根据 `vault.protocol` 调用协议实现。
当前阶段各协议方法只保留类型正确的占位实现，并统一抛出未实现错误。

## 8. 包结构

```text
packages/vault/
├── src/
│   ├── index.ts
│   ├── client.ts
│   ├── types.ts
│   ├── module-context.ts
│   ├── vaults/
│   │   ├── index.ts
│   │   └── types.ts
│   ├── user/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── options.ts
│   ├── protocols/
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   ├── unsupported.ts
│   │   ├── navi-lending/ptb.ts
│   │   └── volo-vault/ptb.ts
│   ├── amount/
│   ├── transport/
│   └── errors/
└── tests/
    └── type-compat/
```

## 9. 当前实现状态

当前代码只保证：

- 包结构与公共导出可用。
- 公共类型满足本方案。
- `Vault.protocol` 能正确收窄 `contractConfig` 类型。
- 公共方法签名可以被 TypeScript 使用。
- 已移除的字段和模块会在类型兼容测试中报错。

以下能力暂不实现：

- Vault API 请求和缓存。
- Vault 数据运行时校验和转换。
- 用户持仓链上查询。
- NAVI Lending 与 Volo Vault PTB 构建。
- 签名、执行和交易确认。
