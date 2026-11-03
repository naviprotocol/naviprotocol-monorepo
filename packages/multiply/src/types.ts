import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { getConfig, Pool, NaviSdkServiceOptions } from '@naviprotocol/lending'

export type MultiplySuiClient = Pick<SuiGrpcClient, 'core'>
export type CoinAmount = { coinType: string; amount: string }
export type CoinInput = { coinType: string; coin: TransactionObjectArgument }
export interface RegistryKey {
  strategyNumericId: string
  strategyVersion: string
}
export interface CapRegistryConfig {
  network: 'sui:mainnet'
  packageId: string
  objectId: string
}
export interface Strategy {
  id: string
  registryKey: RegistryKey
  market: string
  principalCoinType: string
  collateralCoinType: string
  debtCoinType: string
  /** Reserved for strategies with an explicitly supported E-Mode risk model. */
  emodeId?: number
}
export type Action =
  | { type: 'open'; amount: string; targetLeverage: string }
  | { type: 'add_principal' | 'remove_principal'; amount: string; targetLeverage?: string }
  | { type: 'set_leverage'; targetLeverage: string }
  | { type: 'repay' | 'add_collateral'; amount: string }
  | { type: 'close' }
export interface Constraints {
  minHealthFactor: string
  maxSlippageBps: number
  /** Additional ceiling on estimated leverage; omitted means protocol/HF limits apply. */
  maxLeverage?: string
}
export interface AccountCap {
  id: string
  accountOwner: string
  strategyId: string
  registryKey: RegistryKey
}
export interface PositionAmounts {
  /** Native Coin<T> atoms, not NAVI's normalized lending balance units. */
  collateralAmount: string
  debtAmount: string
}
export interface Position extends PositionAmounts {
  address: string
  strategy: Strategy
  accountCap: AccountCap
  healthFactor: string | null
  leverage: string | null
}
export type LendingConfig = Awaited<ReturnType<typeof getConfig>>
export interface MarketSnapshot {
  config: LendingConfig
  collateral: Pool
  debt: Pool
  /** USD per whole token. Pool capacities retain the lending SDK's documented units. */
  collateralPrice: string
  debtPrice: string
  ltv: string
  liquidationThreshold: string
  borrowWeight: string
  flash: { config: LendingConfig; poolId: string; max: string; min: string; feeBps: string }
  observedAt: number
}
/** Implementations must fail closed on incomplete reads; these methods never sign or broadcast. */
export interface DataSource {
  /** Deployment used for discovery. A custom source must declare its binding. */
  capRegistry: CapRegistryConfig
  listAccountCaps(address: string): Promise<AccountCap[]>
  readMarket(strategy: Strategy): Promise<MarketSnapshot>
  readPosition(
    cap: AccountCap,
    strategy: Strategy,
    market?: MarketSnapshot
  ): Promise<PositionAmounts>
  readBorrowFeeBps(market: MarketSnapshot, accountOwner?: string): Promise<string>
  prepareOracle(tx: Transaction, strategy: Strategy, market: MarketSnapshot): Promise<void>
}
export interface ConversionRequest {
  coinIn: string
  coinOut: string
  amountIn: string
  slippageBps: number
}
export interface ConversionQuote {
  converterId: string
  input: CoinAmount
  expectedOutput: CoinAmount
  minOutput: CoinAmount
  expiresAt: number
  /** Opaque JSON, interpreted only by the converter that produced it. */
  data: unknown
}
export interface Converter {
  id: string
  supports(coinIn: string, coinOut: string): boolean
  quote(request: ConversionRequest): Promise<ConversionQuote>
  buildPTB(
    tx: Transaction,
    quote: ConversionQuote,
    coinIn: TransactionObjectArgument,
    /** Multiply binds this to quote.address; required by the Astros converter. */
    context?: { changeRecipient: string }
  ): Promise<{ coinOut: TransactionObjectArgument; change: CoinInput[] }>
}
export interface ExecutionPlan {
  version: 3
  capRegistry: CapRegistryConfig
  accountCap: { kind: 'create'; registryKey: RegistryKey } | ({ kind: 'existing' } & AccountCap)
  snapshot: PositionAmounts
  market: MarketSnapshot
  conversions: ConversionQuote[]
  direction: 'increase' | 'decrease' | 'repay' | 'add_collateral'
  flashAmount: string
  flashRepayment: string
  borrowAmount: string
  borrowFee: string
  withdrawAmount: string
  collateralAfter: string
  debtAfter: string
  minCollateralAfter: string
  /** Binds all quote data for accidental modification detection, not authentication. */
  checksum: string
}
export interface MultiplyQuote {
  address: string
  strategy: Strategy
  action: Action
  constraints: Constraints
  expiresAt: number
  estimate: {
    inputs: CoinAmount[]
    outputs: CoinAmount[]
    minOutputs: CoinAmount[]
    healthFactor: string | null
    leverage: string | null
  }
  execution: ExecutionPlan
}
export interface BuildInputs {
  coins: CoinInput[]
  accountCap?: TransactionObjectArgument
}
export interface BuildResult {
  /** Remaining engine coins. Astros route change is transferred to quote.address directly. */
  coins: CoinInput[]
  accountCap: TransactionObjectArgument
  createdAccountCap?: TransactionObjectArgument
}
export interface MultiplyOptions {
  client?: MultiplySuiClient
  capRegistry?: CapRegistryConfig
  dataSource?: DataSource
  strategies?: Strategy[]
  converters?: Converter[]
  /** Omitted: Astros. Used only when no eligible primary converter can quote. */
  fallbackConverter?: Converter
  services?: NaviSdkServiceOptions
}
