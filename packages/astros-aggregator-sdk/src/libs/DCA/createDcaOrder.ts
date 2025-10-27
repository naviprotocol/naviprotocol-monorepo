/**
 * Create DCA Order Function
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'
import { DcaOrderParams } from './types'
import { AggregatorConfig } from '../Aggregator'
import { getDcaPackageId } from './getDcaPackageId'
import { convertToRawParams } from './utils'

/**
 * Get coin decimals from coin metadata
 * @param client - SuiClient instance
 * @param coinType - Coin type string (e.g., '0x2::sui::SUI')
 * @returns Coin decimals (e.g., 9 for SUI)
 */
async function getCoinDecimals(client: SuiClient, coinType: string): Promise<number> {
  try {
    const metadata = await client.getCoinMetadata({ coinType })
    if (!metadata) {
      throw new Error(`Coin metadata not found for ${coinType}`)
    }
    return metadata.decimals
  } catch (error) {
    throw new Error(`Failed to fetch coin decimals for ${coinType}: ${error}`)
  }
}

/**
 * Creates a new DCA order with the specified parameters
 *
 * @example
 * ```typescript
 * import { createDcaOrder, TimeUnit } from '@astros/sdk'
 *
 * const tx = await createDcaOrder(
 *   client,
 *   {
 *     fromCoinType: '0x2::sui::SUI',
 *     toCoinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
 *     depositedAmount: 1, // 1 SUI total
 *     frequency: { value: 1, unit: TimeUnit.HOURS }, // Execute every 1 hour
 *     totalExecutions: 10, // Execute 10 times (0.1 SUI per execution)
 *     cliff: { value: 5, unit: TimeUnit.MINUTES }, // Wait 5 minutes before first execution
 *     priceRange: {
 *       min: 60, // Minimum 60 NAVX per execution (price protection)
 *       max: 70  // Maximum 70 NAVX per execution (price protection)
 *     }
 *   },
 *   coinObjectId,
 *   ownerAddress
 * )
 * ```
 *
 * @param client - SuiClient instance for fetching coin metadata
 * @param params - DCA order configuration parameters (user-friendly format)
 * @param coinObjectId - Coin object ID to deposit from
 * @param ownerAddress - Address to receive the Receipt object
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function createDcaOrder(
  client: SuiClient,
  params: DcaOrderParams,
  coinObjectId: string,
  ownerAddress: string
): Promise<Transaction> {
  if (!coinObjectId) {
    throw new Error('coinObjectId is required for the deposit')
  }

  // Fetch coin decimals from on-chain metadata
  const [fromCoinDecimals, toCoinDecimals] = await Promise.all([
    getCoinDecimals(client, params.fromCoinType),
    getCoinDecimals(client, params.toCoinType)
  ])

  // Convert user-friendly parameters to raw on-chain format
  const rawParams = convertToRawParams(params, fromCoinDecimals, toCoinDecimals)

  const tx = new Transaction()

  const [depositCoin] = tx.splitCoins(tx.object(coinObjectId), [rawParams.depositedAmount])

  const balance = tx.moveCall({
    target: `0x2::coin::into_balance`,
    arguments: [depositCoin],
    typeArguments: [rawParams.fromCoinType]
  })

  const receipt = tx.moveCall({
    target: `${getDcaPackageId()}::main::create_order`,
    arguments: [
      tx.object(AggregatorConfig.dcaGlobalConfig),
      tx.object(AggregatorConfig.dcaRegistry),
      balance,
      tx.pure.u64(rawParams.gapFrequency), // Gap frequency value
      tx.pure.u8(rawParams.gapUnit), // Gap time unit (0=second, 1=minute, 2=hour, 3=day)
      tx.pure.u64(rawParams.orderNum),
      tx.pure.u64(rawParams.cliffFrequency), // Cliff frequency value
      tx.pure.u8(rawParams.cliffUnit), // Cliff time unit
      tx.pure.u64(rawParams.minAmountOut),
      tx.pure.u64(rawParams.maxAmountOut),
      tx.object('0x6')
    ],
    typeArguments: [rawParams.fromCoinType, rawParams.toCoinType]
  })

  // Ensure the created Receipt object is transferred to the owner to avoid unused value error
  tx.transferObjects([receipt], tx.pure.address(ownerAddress))

  return tx
}
