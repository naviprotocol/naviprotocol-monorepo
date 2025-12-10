/**
 * Create DCA Order Function
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'
import { DcaOrderParams, DcaOptions } from './types'
import { getDcaConfig } from './getDcaConfig'
import { convertToRawParams, CoinDecimals } from './utils'
import { getCoinForDca } from './coinUtils'

/**
 * Fetch coin decimals from chain
 */
async function fetchCoinDecimals(client: SuiClient, coinType: string): Promise<number> {
  const metadata = await client.getCoinMetadata({ coinType })
  if (metadata?.decimals === undefined) {
    throw new Error(`Failed to fetch decimals for coin type: ${coinType}`)
  }
  return metadata.decimals
}

/**
 * Creates a new DCA order with automatic coin selection and merging
 *
 * NOTE: All amount fields must be in atomic units (not normalized)
 *
 * @example
 * ```typescript
 * import { createDcaOrder, TimeUnit } from '@astros/sdk'
 *
 * // Example: SUI -> NAVX (NAVX has 6 decimals)
 * // If 1 SUI = 22 NAVX, pass 22000000 (22 * 10^6)
 * const tx = await createDcaOrder(
 *   client,
 *   userAddress,
 *   {
 *     fromCoinType: '0x2::sui::SUI',
 *     toCoinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
 *     depositedAmount: '1000000000', // 1 SUI total (in atomic units: 1 * 10^9)
 *     frequency: { value: 1, unit: TimeUnit.HOURS },
 *     totalExecutions: 10,
 *     priceRange: { minBuyPrice: 20000000, maxBuyPrice: 25000000 } // optional: 1 SUI = 20~25 NAVX
 *   }
 * )
 * ```
 *
 * @param client - SuiClient instance for fetching coins
 * @param userAddress - User's wallet address (owner of coins and receipt)
 * @param params - DCA order configuration parameters (amounts in atomic units)
 * @param dcaOptions - Optional: DCA contract configuration overrides (for testing)
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function createDcaOrder(
  client: SuiClient,
  userAddress: string,
  params: DcaOrderParams,
  dcaOptions?: DcaOptions
): Promise<Transaction> {
  // Fetch fromCoin decimals (required for price conversion if priceRange is set)
  const fromDecimals = await fetchCoinDecimals(client, params.fromCoinType)
  const decimals: CoinDecimals = { fromDecimals }

  // Convert parameters to raw on-chain format (with decimals for price conversion)
  const rawParams = convertToRawParams(params, decimals)

  // Get DCA configuration (with optional overrides)
  const dcaConfig = getDcaConfig(dcaOptions)

  const tx = new Transaction()

  // Automatic coin selection and merging
  const depositCoin = await getCoinForDca(
    client,
    tx,
    userAddress,
    params.fromCoinType,
    rawParams.depositedAmount
  )

  const balance = tx.moveCall({
    target: `0x2::coin::into_balance`,
    arguments: [depositCoin],
    typeArguments: [rawParams.fromCoinType]
  })

  const receipt = tx.moveCall({
    target: `${dcaConfig.dcaContract}::order_registry::create_order`,
    arguments: [
      tx.object(dcaConfig.dcaRegistry),
      tx.object(dcaConfig.dcaGlobalConfig),
      balance,
      tx.pure.u64(rawParams.gapFrequency),
      tx.pure.u8(rawParams.gapUnit),
      tx.pure.u64(rawParams.orderNum),
      tx.pure.u64(rawParams.cliffFrequency),
      tx.pure.u8(rawParams.cliffUnit),
      tx.pure.u64(rawParams.minAmountOut),
      tx.pure.u64(rawParams.maxAmountOut),
      tx.object('0x6')
    ],
    typeArguments: [rawParams.fromCoinType, rawParams.toCoinType]
  })

  // Ensure the created Receipt object is transferred to the owner
  tx.transferObjects([receipt], tx.pure.address(userAddress))

  return tx
}
