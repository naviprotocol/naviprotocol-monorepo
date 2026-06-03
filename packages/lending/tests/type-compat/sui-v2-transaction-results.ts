import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'

import {
  borrowCoinPTB,
  depositCoinPTB,
  repayCoinPTB,
  withdrawCoinPTB,
  type CoinObject
} from '@naviprotocol/lending'

declare const tx: Transaction
declare const address: string

const suiCoinType = '0x2::sui::SUI'

function expectObjectArgument(value: TransactionObjectArgument | string) {
  return value
}

async function acceptsReturnedSingleCoinResults() {
  const [withdrawnCoin] = await withdrawCoinPTB(tx, suiCoinType, 1)
  expectObjectArgument(withdrawnCoin)
  tx.transferObjects([withdrawnCoin], tx.pure.address(address))
  await depositCoinPTB(tx, suiCoinType, withdrawnCoin, { amount: 1 })

  const [borrowedCoin] = await borrowCoinPTB(tx, suiCoinType, 1)
  expectObjectArgument(borrowedCoin)
  tx.transferObjects([borrowedCoin], tx.pure.address(address))
}

async function acceptsSuiV2SplitCoinResults() {
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
  const coinObject: CoinObject = coin

  await depositCoinPTB(tx, suiCoinType, coinObject, { amount: 1 })
  await repayCoinPTB(tx, suiCoinType, coinObject, { amount: 1 })
}

void acceptsReturnedSingleCoinResults
void acceptsSuiV2SplitCoinResults
