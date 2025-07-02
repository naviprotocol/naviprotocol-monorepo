import type { OraclePriceFeed, EnvOption, UserLendingInfo } from './types'

export async function getPriceFeeds(options?: Partial<EnvOption>): Promise<OraclePriceFeed[]> {
  return []
}

export function filterPriceFeedsByUserLendingState(
  feeds: OraclePriceFeed[],
  lendingState: UserLendingInfo
): OraclePriceFeed[] {
  return []
}
