import { LendingPool, LendingProtocol } from '.'
import { Transaction, TransactionObjectInput, TransactionResult } from '@mysten/sui/transactions'
import { withdrawCoinPTB, repayCoinPTB, CoinObject, getPool } from '@naviprotocol/lending'
import { WalletClient } from '../../../client'
import BigNumber from 'bignumber.js'
import { normalizeStructTag } from '@mysten/sui/utils'

class NaviProtocol implements LendingProtocol {
  readonly name = 'navi'
  private walletClient: WalletClient

  constructor(walletClient: WalletClient) {
    this.walletClient = walletClient
  }

  async getPool(coinType: string): Promise<LendingPool> {
    const pool = await this.walletClient.lending.getPool(coinType)
    const lendingState = await this.walletClient.lending.getLendingState()
    const userPosition = lendingState.find(
      (position) => position.pool.suiCoinType === normalizeStructTag(coinType)
    )

    const supplyBalance = userPosition ? new BigNumber(userPosition.supplyBalance).toNumber() : 0
    const borrowBalance = userPosition ? new BigNumber(userPosition.borrowBalance).toNumber() : 0

    return {
      supplyBalance: supplyBalance,
      borrowBalance: borrowBalance,
      borrowAPR: parseFloat(pool.borrowIncentiveApyInfo.apy)
    }
  }

  async depositCoinPTB(
    tx: Transaction,
    coinType: string,
    coinObject: TransactionObjectInput,
    amount: number
  ): Promise<void> {
    throw new Error('Not implemented')
  }

  async withdrawCoinPTB(
    tx: Transaction,
    coinType: string,
    amount: number
  ): Promise<TransactionResult> {
    return withdrawCoinPTB(tx, coinType, amount)
  }

  async borrowCoinPTB(
    tx: Transaction,
    coinType: string,
    amount: number
  ): Promise<TransactionResult> {
    throw new Error('Not implemented')
  }

  async repayCoinPTB(
    tx: Transaction,
    coinType: string,
    coinObject: CoinObject,
    amount: number
  ): Promise<void> {
    repayCoinPTB(tx, coinType, coinObject, { amount })
  }
}

export default NaviProtocol
