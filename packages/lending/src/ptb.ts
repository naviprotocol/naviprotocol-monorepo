import type { Transaction, TransactionResult } from '@mysten/sui/transactions'
import type { EnvOption, LendingClaimedReward, OraclePriceFeed, Pool } from './types'
import { CoinStruct } from '@mysten/sui/client'

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
  return {} as any
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
