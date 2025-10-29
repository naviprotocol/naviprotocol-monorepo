/**
 * Create DCA Order Function
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'
import { DcaOrderParams, DcaOptions } from './types'
import { getDcaConfig } from './getDcaConfig'
import { convertToRawParams } from './utils'
import { getCoinForDca } from './coinUtils'

/**
 * Creates a new DCA order with automatic coin selection and merging
 *
 * NOTE: All amount fields must be in atomic units (not normalized)
 *
 * @example
 * ```typescript
 * import { createDcaOrder, TimeUnit } from '@astros/sdk'
 *
 * // Use default production config
 * const tx = await createDcaOrder(
 *   client,
 *   userAddress,
 *   {
 *     fromCoinType: '0x2::sui::SUI',
 *     toCoinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
 *     depositedAmount: '1000000000', // 1 SUI total (in atomic units: 1 * 10^9)
 *     frequency: { value: 1, unit: TimeUnit.HOURS },
 *     totalExecutions: 10,
 *   }
 * )
 *
 * // Override for testing environment
 * const testTx = await createDcaOrder(
 *   client,
 *   params,
 *   coinObjectId,
 *   ownerAddress,
 *   {
 *     dcaContract: '0xTEST_PACKAGE_ID',
 *     dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
 *     dcaRegistry: '0xTEST_REGISTRY'
 *   }
 * )
 * ```
 *
<<<<<<< HEAD
 * @param client - SuiClient instance for fetching coins
 * @param userAddress - User's wallet address (owner of coins and receipt)
 * @param params - DCA order configuration parameters (amounts in atomic units)
 * @param dcaOptions - Optional: DCA contract configuration overrides (for testing)
=======
 * @param client - SuiClient instance for fetching coin metadata
 * @param params - DCA order configuration parameters (user-friendly format)
 * @param coinObjectId - Coin object ID to deposit from
 * @param ownerAddress - Address to receive the Receipt object
 * @param dcaOptions - Optional DCA contract configuration overrides (for testing)
>>>>>>> a3e7397 (create dcaOption)
 * @returns Promise<Transaction> - Transaction object ready to be signed and executed
 */
export async function createDcaOrder(
  client: SuiClient,
  userAddress: string,
  params: DcaOrderParams,
<<<<<<< HEAD
=======
  coinObjectId: string,
  ownerAddress: string,
>>>>>>> a3e7397 (create dcaOption)
  dcaOptions?: DcaOptions
): Promise<Transaction> {
  // Convert parameters to raw on-chain format
  const rawParams = convertToRawParams(params)

  // Get DCA configuration (with optional overrides)
  const dcaConfig = getDcaConfig(dcaOptions)

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
    target: `${dcaConfig.dcaContract}::main::create_order`,
    arguments: [
      tx.object(dcaConfig.dcaGlobalConfig),
      tx.object(dcaConfig.dcaRegistry),
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
  tx.transferObjects([receipt], tx.pure.address(userAddress))

  return tx
}
