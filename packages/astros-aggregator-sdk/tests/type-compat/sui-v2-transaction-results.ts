import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'

import {
  buildSwapPTBFromQuote,
  type Quote,
  type SingleCoinTransactionResult
} from '@naviprotocol/astros-aggregator-sdk'

declare const tx: Transaction
declare const address: string

const suiCoinType = '0x2::sui::SUI'

function expectObjectArgument(value: TransactionObjectArgument | string) {
  return value
}

async function acceptsSwapOutputAsSingleCoinResult() {
  const coinIn = tx.splitCoins(tx.gas, [1n])
  const quote: Quote = {
    routes: [{ amount_in: 1, amount_out: 1, path: [] }],
    amount_in: '1',
    amount_out: '1',
    from: suiCoinType,
    target: suiCoinType,
    dexList: [],
    high_price_impact: false
  }

  let repayCoin: SingleCoinTransactionResult = tx.moveCall({
    target: '0x2::coin::zero',
    typeArguments: [suiCoinType]
  }) as SingleCoinTransactionResult

  repayCoin = await buildSwapPTBFromQuote(address, tx, 1, coinIn, quote, 0, false)
  expectObjectArgument(repayCoin[0])
  tx.transferObjects([repayCoin], address)
}

void acceptsSwapOutputAsSingleCoinResult
