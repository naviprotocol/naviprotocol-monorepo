import { Transaction } from '@mysten/sui/transactions'

/**
 * Merges multiple coins into a single coin object.
 *
 * @param txb - The transaction block object.
 * @param coinInfo - The coin information object.
 * @returns The merged coin object.
 */
export function returnMergedCoins(txb: Transaction, coinInfo: any) {
  if (coinInfo.data.length >= 2) {
    let baseObj = coinInfo.data[0].coinObjectId
    let all_list = coinInfo.data.slice(1).map((coin: any) => coin.coinObjectId)

    txb.mergeCoins(baseObj, all_list)
  }

  let mergedCoinObject = txb.object(coinInfo.data[0].coinObjectId)
  return mergedCoinObject
}

/**
 * Signs and submits a transaction block using the provided client and keypair.
 * @param txb - The transaction block to sign and submit.
 * @param client - The client object used to sign and execute the transaction block.
 * @param keypair - The keypair used as the signer for the transaction block.
 * @returns A promise that resolves to the result of signing and executing the transaction block.
 */
export async function SignAndSubmitTXB(txb: Transaction, client: any, keypair: any) {
  const result = await client.signAndExecuteTransaction({
    transaction: txb,
    signer: keypair,
    requestType: 'WaitForLocalExecution',
    options: {
      showEffects: true
    }
  })
  return result
}
