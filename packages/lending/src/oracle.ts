/**
 * Oracle Price Feed Management for Lending Protocol
 *
 * This module provides oracle price feed functionality for the lending protocol.
 * It integrates with Pyth Network for real-time price data and manages price updates
 * for various assets used in lending operations.
 */

import { getConfig, DEFAULT_CACHE_TIME } from './config'
import type {
  OraclePriceFeed,
  EnvOption,
  UserLendingInfo,
  Pool,
  SuiClientOption,
  MarketOption,
  LendingPosition,
  ServiceOption
} from './types'
import { SuiPriceServiceConnection, SuiPythClient } from './pyth'
import { Transaction } from '@mysten/sui/transactions'
import { multiGetSuiObjects, suiClient } from './utils'
import { getLendingPositions } from './account'

type PythInfo = {
  priceFeedId: string
  priceInfoObject: string
  expiration?: number
}

export type PythPriceInfo = {
  priceFeedId: string
  priceInfoObject: string
  price: string
  conf: string
  publishTime: number
  expiration?: number
}

/**
 * Pyth Network connection for price feed data
 * Connects to the Hermes endpoint for real-time price updates
 */
const pythConnections = new Map<string, SuiPriceServiceConnection>()
const getPythConnection = (endpoint?: string) => {
  const url = endpoint ?? 'https://hermes.pyth.network'
  let conn = pythConnections.get(url)
  if (!conn) {
    conn = new SuiPriceServiceConnection(url, { timeout: 10000 })
    pythConnections.set(url, conn)
  }
  return conn
}

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
export async function getPythStalePriceFeedId(
  priceIds: string[],
  options?: Partial<EnvOption & MarketOption>
): Promise<string[]> {
  try {
    const returnData: string[] = []
    const config = await getConfig({ ...options, cacheTime: DEFAULT_CACHE_TIME })
    const latestPriceFeeds = await getPythConnection(
      config.oracle.hermesEndpoint
    ).getLatestPriceFeeds(priceIds)
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

async function getOnChainPriceInfo(
  pythInfos: PythInfo[],
  options?: Partial<SuiClientOption>
): Promise<PythPriceInfo[]> {
  // Whole-read failures (endpoint/RPC errors) propagate to the caller:
  // swallowing them here would silently skip the Pyth staleness update and let
  // transactions build against stale on-chain prices. Only per-feed anomalies
  // are skipped below.
  const priceInfos: PythPriceInfo[] = []
  const client = options?.client ?? suiClient

  const priceInfoObjectIds = pythInfos.map((k) => k.priceInfoObject)
  const priceInfoObjects = await multiGetSuiObjects(client, {
    ids: Array.from(new Set(priceInfoObjectIds)),
    options: { showContent: true }
  })
  for (const obj of priceInfoObjects) {
    const data = obj.data
    if (!data || !data.content || data.content.dataType !== 'moveObject') {
      console.warn(`fetched object ${data?.objectId} datatype should be moveObject`)
      continue
    }

    const pythInfo = pythInfos.find((v) => v.priceInfoObject == data.objectId)
    if (!pythInfo) {
      console.warn(`unable to find pyth info from array, priceInfoObject: ${data.objectId}`)
      continue
    }

    // The Sui v2 client returns nested Move structs directly, without the
    // per-level `.fields` wrapper the legacy JSON-RPC object shape carried.
    // Read the flattened shape and skip (not throw) on an unexpected object so
    // a single malformed feed can't abort the whole batch and silently leave
    // every on-chain price un-refreshed.
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    const priceStruct = data.content.fields?.price_info?.price_feed?.price
    const priceValue = priceStruct?.price
    if (!priceValue) {
      console.warn(`unexpected pyth price struct, priceInfoObject: ${data.objectId}`)
      continue
    }
    const { magnitude, negative } = priceValue
    const conf = priceStruct.conf
    const timestamp = priceStruct.timestamp

    priceInfos.push({
      priceFeedId: pythInfo.priceFeedId,
      priceInfoObject: pythInfo.priceInfoObject,
      price: negative ? '-' + magnitude : magnitude,
      conf,
      publishTime: Number(timestamp),
      expiration: pythInfo.expiration
    })
  }
  return priceInfos
}

export async function getPythStalePriceFeedIdV2(
  pythInfos: PythInfo[],
  options?: Partial<SuiClientOption>
): Promise<string[]> {
  try {
    const returnData: string[] = []
    const latestPriceFeeds = await getOnChainPriceInfo(pythInfos, options)
    if (!latestPriceFeeds) return returnData

    const currentTimestamp = Math.floor(new Date().valueOf() / 1000)

    for (const priceFeed of latestPriceFeeds) {
      if (priceFeed.publishTime > currentTimestamp) {
        console.warn(
          `pyth price feed is invalid, id: ${priceFeed.priceFeedId}, publish time: ${priceFeed.publishTime}, current timestamp: ${currentTimestamp}`
        )
        continue
      }

      const maxTime = priceFeed.expiration || 60
      // 3s is the margin of error for the price feed.
      if (currentTimestamp - priceFeed.publishTime > maxTime) {
        console.info(
          `stale price feed, id: ${priceFeed.priceFeedId}, publish time: ${priceFeed.publishTime}, current timestamp: ${currentTimestamp}`
        )
        returnData.push(priceFeed.priceFeedId)
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
  options?: Partial<SuiClientOption & EnvOption & MarketOption>
) {
  const client = options?.client ?? suiClient
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  try {
    const priceUpdateData = await getPythConnection(
      config.oracle.hermesEndpoint
    ).getPriceFeedsUpdateData(priceFeedIds)
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
    EnvOption &
      SuiClientOption &
      ServiceOption &
      MarketOption & {
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
    const pythInfos = priceFeeds
      .filter((feed) => !!feed.pythPriceFeedId && !!feed.pythPriceInfoObject)
      .map((feed) => ({
        priceFeedId: feed.pythPriceFeedId,
        priceInfoObject: feed.pythPriceInfoObject,
        expiration: 30
      }))

    // Do not silently swallow Pyth stale-price update failures: the previous
    // catch kept building the tx with possibly stale on-chain prices and masked
    // real endpoint/RPC errors. Throw so callers are aware (avoids
    // lending/liquidation based on stale prices).
    const stalePriceFeedIds = await getPythStalePriceFeedIdV2(pythInfos, options)
    if (stalePriceFeedIds.length > 0) {
      await updatePythPriceFeeds(tx, stalePriceFeedIds, options)
    }
  }

  // Update individual price feeds in the oracle contract
  for (const priceFeed of priceFeeds) {
    tx.moveCall({
      target: `${config.oracle.packageId}::oracle_pro::${config.oracle.updateFunction ?? 'update_single_price_v2'}`,
      arguments: [
        tx.object('0x6'), // Clock object
        tx.object(config.oracle.oracleConfig), // Oracle configuration
        tx.object(config.oracle.priceOracle), // Price oracle contract
        tx.object(config.oracle.supraOracleHolder), // Supra oracle holder
        tx.object(priceFeed.pythPriceInfoObject), // Pyth price info object
        tx.object(config.oracle.switchboardAggregator),
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
export async function getPriceFeeds(
  options?: Partial<EnvOption & ServiceOption>
): Promise<OraclePriceFeed[]> {
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
    lendingPositions?: LendingPosition[]
  }
): OraclePriceFeed[] {
  return feeds.filter((feed) => {
    // Filter by lending state (user's current positions)
    if (filters?.lendingState) {
      const inState = filters.lendingState.find((state) => {
        return feed.oracleId === state.pool.oracleId
      })
      if (inState) {
        return true
      }
    }

    if (filters?.lendingPositions) {
      const inPosition = filters.lendingPositions.find((position) => {
        const availableTypes = [
          'navi-lending-supply',
          'navi-lending-borrow',
          'navi-lending-emode-supply',
          'navi-lending-emode-borrow'
        ]
        if (!availableTypes.includes(position.type)) {
          return false
        }
        const pool = position[position.type]?.pool
        return feed.oracleId === pool?.oracleId
      })
      if (inPosition) {
        return true
      }
    }

    // Filter by available pools
    if (filters?.pools) {
      const inPool = filters.pools.find((pool) => {
        return feed.oracleId === pool.oracleId
      })
      if (inPool) {
        return true
      }
    }
    return false
  })
}

export async function updateOraclePriceBeforeUserOperationPTB(
  tx: Transaction,
  address: string,
  pools: Pool[],
  options?: Partial<
    EnvOption &
      SuiClientOption &
      MarketOption & {
        throws?: boolean
      }
  >
) {
  let relevantFeeds: OraclePriceFeed[] | undefined
  try {
    const allPriceFeeds = await getPriceFeeds({
      ...options
    })

    const markets = [] as string[]

    pools.forEach((pool) => {
      if (!markets.includes(pool.market)) {
        markets.push(pool.market)
      }
    })

    const lendingPositions = await getLendingPositions(address, {
      ...options,
      markets
    })

    relevantFeeds = filterPriceFeeds(allPriceFeeds, {
      lendingPositions,
      pools
    })

    const updatedTx = await updateOraclePricesPTB(tx, relevantFeeds, {
      updatePythPriceFeeds: true,
      ...options
    })
    return updatedTx
  } catch (e) {
    if (options?.throws) {
      throw e
    }
    console.error(e)
    // Degraded path: a Pyth refresh failure happens before any moveCall is
    // appended, so the tx is still clean. Retry the oracle update without the
    // Pyth feed refresh (matches the pre-v2 behavior where Pyth failures were
    // swallowed but update_single_price calls were still appended) instead of
    // dropping the oracle update entirely.
    if (relevantFeeds) {
      try {
        return await updateOraclePricesPTB(tx, relevantFeeds, {
          ...options,
          updatePythPriceFeeds: false
        })
      } catch (fallbackError) {
        console.error(fallbackError)
      }
    }
    return tx
  }
}
