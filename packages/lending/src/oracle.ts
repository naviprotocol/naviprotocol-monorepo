/**
 * Oracle Price Feed Management for Lending Protocol
 *
 * This module provides oracle price feed functionality for the lending protocol.
 * It integrates with Pyth Network for real-time price data and manages price updates
 * for various assets used in lending operations.
 */

import { getConfig, DEFAULT_CACHE_TIME } from './config'
import type { OraclePriceFeed, EnvOption, UserLendingInfo, Pool, SuiClientOption } from './types'
import { SuiPriceServiceConnection, SuiPythClient } from '@pythnetwork/pyth-sui-js'
import { Transaction } from '@mysten/sui/transactions'
import { suiClient } from './utils'

/**
 * Pyth Network connection for price feed data
 * Connects to the Hermes endpoint for real-time price updates
 */
const suiPythConnection = new SuiPriceServiceConnection('https://hermes.pyth.network', {
  timeout: 10000
})

/**
 * Get stale price feed IDs from Pyth Network
 *
 * Identifies price feeds that have not been updated recently (more than 30 seconds old).
 * This helps ensure that only fresh price data is used for lending operations.
 *
 * @param priceIds - Array of Pyth price feed IDs to check
 * @returns Array of stale price feed IDs that need updating
 * @throws Error if failed to fetch price feed data
 */
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

/**
 * Update Pyth price feeds in a transaction
 *
 * Fetches the latest price update data from Pyth Network and adds the update
 * operations to the transaction block.
 *
 * @param tx - The transaction block to add price feed updates to
 * @param priceFeedIds - Array of Pyth price feed IDs to update
 * @param options - Optional client and environment configuration
 * @returns Promise that resolves when price feeds are updated
 * @throws Error if failed to update price feeds
 */
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

/**
 * Update oracle prices in the PTB (Programmable Transaction Block)
 *
 * This function updates price feeds for the lending protocol. It can optionally
 * update Pyth price feeds first if they are stale, then updates individual
 * price feeds in the oracle contract.
 *
 * @param tx - The transaction block to add price update operations to
 * @param priceFeeds - Array of oracle price feeds to update
 * @param options - Optional configuration including whether to update Pyth feeds
 * @returns The updated transaction block
 */
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

  // Optionally update Pyth price feeds if they are stale
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

  // Update individual price feeds in the oracle contract
  for (const priceFeed of priceFeeds) {
    tx.moveCall({
      target: `${config.oracle.packageId}::oracle_pro::update_single_price_v2`,
      arguments: [
        tx.object('0x6'), // Clock object
        tx.object(config.oracle.oracleConfig), // Oracle configuration
        tx.object(config.oracle.priceOracle), // Price oracle contract
        tx.object(config.oracle.supraOracleHolder), // Supra oracle holder
        tx.object(priceFeed.pythPriceInfoObject), // Pyth price info object
        tx.object(config.oracle.switchboardAggregator), // Gas object
        tx.pure.address(priceFeed.feedId) // Price feed ID
      ]
    })
  }
  return tx
}

/**
 * Get all available price feeds from the configuration
 *
 * @param options - Optional environment configuration
 * @returns Array of oracle price feed configurations
 */
export async function getPriceFeeds(options?: Partial<EnvOption>): Promise<OraclePriceFeed[]> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  return config.oracle.feeds
}

/**
 * Filter price feeds based on lending state and pools
 *
 * This function filters price feeds to only include those that are relevant
 * to the current lending state or available pools.
 *
 * @param feeds - Array of price feeds to filter
 * @param filters - Filter criteria including lending state and pools
 * @returns Filtered array of price feeds
 */
export function filterPriceFeeds(
  feeds: OraclePriceFeed[],
  filters: {
    lendingState?: UserLendingInfo[]
    pools?: Pool[]
  }
): OraclePriceFeed[] {
  return feeds.filter((feed) => {
    // Filter by lending state (user's current positions)
    if (filters?.lendingState) {
      const inState = filters.lendingState.find((state) => {
        return state.assetId === feed.assetId
      })
      if (inState) {
        return true
      }
    }

    // Filter by available pools
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
