import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../Aggregator/config'

function getCoinObjectId(coin: any) {
  const objectId = coin?.coinObjectId ?? coin?.objectId
  if (!objectId) {
    throw new Error('Coin object is missing an object id')
  }
  return objectId
}

/**
 * Merges multiple coins into a single coin object.
 *
 * @param txb - The transaction block object.
 * @param coinInfo - The coin information object.
 * @returns The merged coin object.
 */
export function returnMergedCoins(txb: Transaction, coinInfo: any) {
  if (coinInfo.data.length >= 2) {
    const baseObj = getCoinObjectId(coinInfo.data[0])
    const all_list = coinInfo.data.slice(1).map(getCoinObjectId)

    txb.mergeCoins(baseObj, all_list)
  }

  const mergedCoinObject = txb.object(getCoinObjectId(coinInfo.data[0]))
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

export function moveCallTransferNonzero(
  tx: Transaction,
  coinArg: TransactionObjectArgument | string,
  recipient: string,
  coinType: string
) {
  return tx.moveCall({
    target: `${AggregatorConfig.aggregatorUtilsContract}::coin_utils::transfer_nonzero`,
    typeArguments: [coinType],
    arguments: [tx.object(coinArg), tx.pure.address(recipient)]
  })
}
