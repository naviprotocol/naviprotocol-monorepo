/**
 * DCA Coin Utilities
 * Helper functions for coin selection and merging
 */

import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'

/**
<<<<<<< HEAD
 * Merge coins and return a merged coin object in PTB
 * @param tx - Transaction to build
 * @param coinInfo - Coin data from client.getCoins
=======
 * Get coins for a specific address and coin type
 */
export async function getCoins(
  client: SuiClient,
  address: string,
  coinType: string = '0x2::sui::SUI'
) {
  const coinDetails = await client.getCoins({
    owner: address,
    coinType
  })

  return coinDetails
}

/**
 * Merge coins and return a merged coin object in PTB
 * @param tx - Transaction to build
 * @param coinInfo - Coin data from getCoins
>>>>>>> 4275cb8 (fix few bugs)
 * @returns Merged coin object that can be used in subsequent operations
 */
export function returnMergedCoins(tx: Transaction, coinInfo: any) {
  if (!coinInfo.data || coinInfo.data.length === 0) {
    throw new Error('No coins available')
  }

  // Sort by balance descending to use the largest coin as base
  const sortedCoins = [...coinInfo.data].sort(
    (a: any, b: any) => Number(b.balance) - Number(a.balance)
  )

  // Merge all coins into the largest one if there are multiple coins
  if (sortedCoins.length >= 2) {
    const baseObj = sortedCoins[0].coinObjectId
    const allList = sortedCoins.slice(1).map((coin: any) => coin.coinObjectId)
    tx.mergeCoins(baseObj, allList)
  }

  // Return the merged coin object
  const mergedCoinObject = tx.object(sortedCoins[0].coinObjectId)
  return mergedCoinObject
}

/**
 * Get and prepare coin for DCA order creation
 * Automatically fetches coins, merges them, and splits the required amount
 *
 * @param client - SuiClient instance
 * @param tx - Transaction to build
 * @param address - User wallet address
 * @param coinType - Coin type to use
 * @param amount - Amount needed (in atomic units)
 * @returns Transaction result containing the split coin
 */
export async function getCoinForDca(
  client: SuiClient,
  tx: Transaction,
  address: string,
  coinType: string,
  amount: string | number | bigint
): Promise<TransactionResult> {
  if (coinType === '0x2::sui::SUI') {
    // Handle SUI gas coin - split from gas
    return tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
  } else {
    // Handle other token types
<<<<<<< HEAD
    const coinInfo = await client.getCoins({
      owner: address,
      coinType
    })
=======
    const coinInfo = await getCoins(client, address, coinType)
>>>>>>> 4275cb8 (fix few bugs)

    // Check if user has enough balance
    if (!coinInfo.data || coinInfo.data.length === 0) {
      throw new Error(`No ${coinType} coins found for address ${address}`)
    }

    const totalBalance = coinInfo.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n)

    if (totalBalance < BigInt(amount)) {
      throw new Error(`Insufficient balance: need ${amount}, have ${totalBalance}`)
    }

    // Merge all coins
    const mergedCoin = returnMergedCoins(tx, coinInfo)

    // Split the required amount
    return tx.splitCoins(mergedCoin, [tx.pure.u64(amount)])
  }
}
