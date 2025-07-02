import type {
  UserLendingInfo,
  SuiClientOption,
  EnvOption,
  Pool,
  LendingReward,
  Transaction,
  HistoryReward
} from './types'

export async function getUserLendingState(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<UserLendingInfo[]> {
  return []
}

export async function getUserHealthFactor(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  return 0
}

export async function getUserDynamicHealthFactorAfterOperator(
  address: string,
  pool: Pool,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<number> {
  return 0
}

export async function getUserAvailableLendingRewards(
  address: string,
  options?: Partial<SuiClientOption & EnvOption>
): Promise<LendingReward[]> {
  return []
}

export async function getUserTotalClaimedReward(address: string): Promise<{
  USDVaule: number
}> {
  return {
    USDVaule: 0
  }
}

export async function getUserTransactions(address: string): Promise<Transaction[]> {
  return []
}

export async function getUserRewardHistory(
  address: string,
  options?: {
    page?: number
    size?: number
  }
): Promise<HistoryReward[]> {
  return []
}
