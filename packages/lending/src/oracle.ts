import { getConfig, DEFAULT_CACHE_TIME } from './config'
import type { OraclePriceFeed, EnvOption, UserLendingInfo, Pool, SuiClientOption } from './types'
import { SuiPriceServiceConnection, SuiPythClient } from '@pythnetwork/pyth-sui-js'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from './utils'

const suiPythConnection = new SuiPriceServiceConnection('https://hermes.pyth.network', {
  timeout: 20000
})

export async function getPythStalePriceFeedId(priceIds: string[]): Promise<string[]> {
  try {
    const returnData: string[] = []
    const latestPriceFeeds = await suiPythConnection.getLatestPriceFeeds(priceIds)
    if (!latestPriceFeeds) return returnData

    const currentTimestamp = Math.floor(new Date().valueOf() / 1000)
    for (const priceFeed of latestPriceFeeds) {
      const uncheckedPrice = priceFeed.getPriceUnchecked()
      if (uncheckedPrice.publishTime > currentTimestamp) {
        console.warn(
          `pyth price feed is invalid, id: ${priceFeed.id}, publish time: ${uncheckedPrice.publishTime}, current timestamp: ${currentTimestamp}`
        )
        continue
      }

      // From pyth state is 60, but setting it to 30 makes more sense.
      if (currentTimestamp - priceFeed.getPriceUnchecked().publishTime > 30) {
        console.info(
          `stale price feed, id: ${priceFeed.id}, publish time: ${uncheckedPrice.publishTime}, current timestamp: ${currentTimestamp}`
        )
        returnData.push(priceFeed.id)
      }
    }
    return returnData
  } catch (error) {
    throw new Error(`failed to get pyth stale price feed id, msg: ${(error as Error).message}`)
  }
}

export async function updatePythPriceFeeds(
  tx: Transaction,
  priceFeedIds: string[],
  options?: Partial<SuiClientOption & EnvOption>
) {
  const client = options?.client ?? suiClient
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  try {
    const priceUpdateData = await suiPythConnection.getPriceFeedsUpdateData(priceFeedIds)
    const suiPythClient = new SuiPythClient(
      client as any,
      config.oracle.pythStateId,
      config.oracle.wormholeStateId
    )

    return await suiPythClient.updatePriceFeeds(tx as any, priceUpdateData, priceFeedIds)
  } catch (error) {
    throw new Error(`failed to update pyth price feeds, msg: ${(error as Error).message}`)
  }
}

export async function updateOraclePricesPTB(
  tx: Transaction,
  priceFeeds: OraclePriceFeed[],
  options?: Partial<
    EnvOption & {
      updatePythPriceFeeds?: boolean
    }
  >
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (options?.updatePythPriceFeeds) {
    const pythPriceFeedIds = priceFeeds
      .filter((feed) => !!feed.pythPriceFeedId)
      .map((feed) => feed.pythPriceFeedId)

    try {
      const stalePriceFeedIds = await getPythStalePriceFeedId(pythPriceFeedIds)
      if (stalePriceFeedIds.length > 0) {
        await updatePythPriceFeeds(tx, stalePriceFeedIds, options)
      }
    } catch (e) {}
  }
  for (const priceFeed of priceFeeds) {
    tx.moveCall({
      target: `${config.oracle.packageId}::oracle_pro::update_single_price`,
      arguments: [
        tx.object('0x6'),
        tx.object(config.oracle.oracleConfig),
        tx.object(config.oracle.priceOracle),
        tx.object(config.oracle.supraOracleHolder),
        tx.object(priceFeed.pythPriceInfoObject),
        tx.pure.address(priceFeed.feedId)
      ]
    })
  }
  return tx
}

export async function getPriceFeeds(options?: Partial<EnvOption>): Promise<OraclePriceFeed[]> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return config.oracle.feeds
}

export function filterPriceFeeds(
  feeds: OraclePriceFeed[],
  filters: {
    lendingState?: UserLendingInfo[]
    pools?: Pool[]
  }
): OraclePriceFeed[] {
  return feeds.filter((feed) => {
    if (filters?.lendingState) {
      const inState = filters.lendingState.find((state) => {
        return state.assetId === feed.assetId
      })
      if (inState) {
        return true
      }
    }
    if (filters?.pools) {
      const inPool = filters.pools.find((pool) => {
        return pool.id === feed.assetId
      })
      if (inPool) {
        return true
      }
    }
    return false
  })
}
