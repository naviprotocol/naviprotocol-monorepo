import type { Transaction, TransactionResult } from '@mysten/sui/transactions'
import type { EnvOption, LendingClaimedReward, OraclePriceFeed, Pool } from './types'
import { CoinStruct } from '@mysten/sui/client'
import { DEFAULT_CACHE_TIME, getConfig } from './config'
import { parseTxVaule, parseTxPoolVaule, normalizeCoinType } from './utils'
import { getPools } from './pool'

export async function mergeCoinsPTB(
  tx: Transaction,
  coins: CoinStruct[],
  options?: {
    balance?: number
  }
): Promise<Transaction> {
  return tx
}

export async function depositCoinPTB(
  tx: Transaction,
  pool: Pool,
  coinObject: TransactionResult | string,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  return tx
}

export async function depositCoinWithAccountcapPTB(
  tx: Transaction,
  pool: Pool,
  coinObject: TransactionResult | string,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  return tx
}

export async function withdrawCoinPTB(
  tx: Transaction,
  pool: Pool,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  return {
    $kind: 'Result',
    Result: 0
  } as any
}

export async function withdrawCoinWithAccountCapPTB(
  tx: Transaction,
  pool: Pool,
  amount: number | TransactionResult,
  account: string,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  return {
    $kind: 'Result',
    Result: 0
  } as any
}

export async function borrowCoinPTB(
  tx: Transaction,
  pool: Pool,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  return {
    $kind: 'Result',
    Result: 0
  } as any
}

export async function repayCoinPTB(
  tx: Transaction,
  pool: Pool,
  coinObject: TransactionResult | string,
  options?: Partial<
    EnvOption & {
      amount: number | TransactionResult
    }
  >
): Promise<Transaction> {
  return tx
}

export async function getHealthFactorPTB(
  tx: Transaction,
  address: string | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return tx.moveCall({
    target: `${config.package}::logic::user_health_factor`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(config.oracle.priceOracle),
      parseTxVaule(address, tx.pure.address)
    ]
  })
}

export async function getDynamicHealthFactorPTB(
  tx: Transaction,
  address: string | TransactionResult,
  coinType: string | Pool,
  estimatedSupply: number | TransactionResult,
  estimatedBorrow: number | TransactionResult,
  isIncrease: boolean | TransactionResult,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  const pools = await getPools(options)
  const type = typeof coinType === 'string' ? coinType : coinType.suiCoinType
  const pool = pools.find((p) => normalizeCoinType(p.suiCoinType) === normalizeCoinType(type))
  if (!pool) {
    throw new Error(`Pool not found for coin type: ${type}`)
  }
  return tx.moveCall({
    target: `${config.package}::dynamic_calculator::dynamic_health_factor`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.storage),
      tx.object(config.oracle.priceOracle),
      parseTxPoolVaule(tx, pool),
      parseTxVaule(address, tx.pure.address),
      parseTxVaule(pool.id, tx.pure.u8),
      parseTxVaule(estimatedSupply, tx.pure.u64),
      parseTxVaule(estimatedBorrow, tx.pure.u64),
      parseTxVaule(isIncrease, tx.pure.bool)
    ],
    typeArguments: [pool.suiCoinType]
  })
}

export async function flashloanPTB(
  tx: Transaction,
  pool: Pool,
  amount: number | TransactionResult,
  options?: Partial<EnvOption>
): Promise<[TransactionResult, TransactionResult]> {
  return [] as any
}

export async function repayFlashLoanPTB(
  tx: Transaction,
  pool: Pool,
  receipt: TransactionResult | string,
  coinObject: TransactionResult | string,
  options?: Partial<EnvOption>
): Promise<TransactionResult> {
  return {} as any
}

export async function liquidatePTB(
  tx: Transaction,
  payPool: Pool,
  payCoinObject: TransactionResult | string,
  collateralPool: Pool,
  liquidateAddress: TransactionResult | string,
  options?: Partial<EnvOption>
): Promise<[TransactionResult, TransactionResult]> {
  return [] as any
}

export async function claimLendingRewardsPTB(
  tx: Transaction,
  rewards: LendingClaimedReward[],
  options?: Partial<EnvOption>
): Promise<LendingClaimedReward[]> {
  return []
}

export async function sendLendingClaimedRewardToUserPTB(
  tx: Transaction,
  claimedRewards: LendingClaimedReward[],
  address: string | TransactionResult
): Promise<Transaction> {
  return tx
}

export async function depositLendingClaimedRewardPTB(
  tx: Transaction,
  claimedRewards: LendingClaimedReward[]
): Promise<Transaction> {
  return tx
}

export async function updateOraclePricesPTB(
  tx: Transaction,
  priceFeeds: OraclePriceFeed[],
  options?: Partial<EnvOption>
): Promise<Transaction> {
  return tx
}
