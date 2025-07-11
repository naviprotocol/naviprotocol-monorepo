import { Module } from '../module'
import { getUserCoins, mergeCoinsPTB, withSingleton } from '@naviprotocol/lending'
import { CoinStruct } from '@mysten/sui/client'
import type { WalletClient } from '../../client'
import { UserPortfolio } from './portfolio'
import BigNumber from 'bignumber.js'
import { Transaction } from '@mysten/sui/transactions'
import type {
  DryRunTransactionBlockResponse,
  SuiTransactionBlockResponse
} from '@mysten/sui/client'

export interface BalanceModuleConfig {
  coinPollingInterval: number
}

export type Events = {
  'balance:portfolio-updated': {}
}

export class BalanceModule extends Module<BalanceModuleConfig, Events> {
  readonly name = 'balance'
  readonly defaultConfig = {
    coinPollingInterval: 6000
  }

  public get coins() {
    return this._coins
  }

  public get portfolio() {
    return this._portfolio
  }

  public async waitForUpdate() {
    if (!this._updatePromise) {
      throw new Error('Update promise not found')
    }
    return await this._updatePromise
  }

  public async sendCoin<T extends boolean = false>(
    coinType: string,
    recipient: string,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    return this.sendCoinBatch(coinType, [recipient], [amount], options)
  }

  public async sendCoinBatch<T extends boolean = false>(
    coinType: string,
    recipients: string[],
    amounts: number[],
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    if (recipients.length !== amounts.length) {
      throw new Error('Recipients and amounts must have the same length')
    }

    await this.waitForUpdate()

    const coinBalance = this.portfolio.getBalance(coinType)
    const totalAmount = amounts.reduce((acc, curr) => acc.plus(curr), BigNumber(0))
    if (coinBalance.amount.lt(totalAmount)) {
      throw new Error('Insufficient balance')
    }

    const tx = new Transaction()

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: totalAmount.toNumber(),
      useGasCoin: true
    })

    const coins = tx.splitCoins(mergedCoin, amounts)

    recipients.forEach((address, index) => {
      tx.transferObjects([coins[index]], address)
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  async transferObject<T extends boolean = false>(
    object: string,
    recipient: string,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    return this.transferObjectBatch([object], [recipient], options)
  }

  async transferObjectBatch<T extends boolean = false>(
    objects: string[],
    recipients: string[],
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    if (objects.length !== recipients.length) {
      throw new Error('Objects and recipients must have the same length')
    }

    await this.waitForUpdate()

    const tx = new Transaction()

    objects.forEach((object, index) => {
      tx.transferObjects([tx.object(object)], recipients[index])
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  updatePortfolio = withSingleton(async () => {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    this._coins = await getUserCoins(this.walletClient.address, {
      client: this.walletClient.client
    })
    this._portfolio = new UserPortfolio(this._coins)
    this.emit('balance:portfolio-updated', {})
  })

  private _coins: CoinStruct[] = []
  private _portfolio: UserPortfolio = new UserPortfolio()
  private pollingTimer: NodeJS.Timeout | null = null
  private _updatePromise: Promise<void> | null = null

  private async startPolling() {
    try {
      await this.updatePortfolio()
    } catch (error) {
      console.error(error)
    } finally {
      this.pollingTimer = setTimeout(this.startPolling, this.config.coinPollingInterval)
    }
  }

  install(walletClient: WalletClient) {
    super.install(walletClient)
    this.startPolling = this.startPolling.bind(this)
    this.startPolling()
    this._updatePromise = new Promise((resolve) => {
      walletClient.events.on('balance:portfolio-updated', () => {
        resolve()
      })
    })
  }

  uninstall() {
    super.uninstall()
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
  }
}
