import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { CoinObject } from '@naviprotocol/lending'

export interface LendingPool {
  supplyBalance: number
  borrowBalance: number
  borrowAPR: number
}

export interface LendingProtocol {
  name: string

  getPool(coinType: string): Promise<LendingPool>

  depositCoinPTB(
    tx: Transaction,
    coinType: string,
    coinObject: CoinObject,
    amount: number
  ): Promise<void>
  withdrawCoinPTB(tx: Transaction, coinType: string, amount: number): Promise<TransactionResult>
  borrowCoinPTB(tx: Transaction, coinType: string, amount: number): Promise<TransactionResult>
  repayCoinPTB(
    tx: Transaction,
    coinType: string,
    coinObject: CoinObject,
    amount: number
  ): Promise<void>
}
