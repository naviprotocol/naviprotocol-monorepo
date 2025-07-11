/**
 * Balance Module Implementation
 *
 * This module provides comprehensive balance management functionality for the wallet client.
 * It handles coin tracking, portfolio management, coin transfers, and automatic balance updates
 * through polling mechanisms.
 *
 * @module BalanceModule
 */

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

/**
 * Configuration options for the balance module
 */
export interface BalanceModuleConfig {
  /** Interval in milliseconds for polling coin balances */
  coinPollingInterval: number
}

/**
 * Events emitted by the balance module
 */
export type Events = {
  /** Emitted when the portfolio is updated with new balance information */
  'balance:portfolio-updated': {}
}

/**
 * Balance management module for wallet operations
 *
 * This module provides functionality for:
 * - Tracking coin balances and portfolio information
 * - Sending coins to recipients
 * - Transferring objects
 * - Automatic balance updates through polling
 * - Portfolio management and balance queries
 */
export class BalanceModule extends Module<BalanceModuleConfig, Events> {
  /** Module name identifier */
  readonly name = 'balance'

  /** Default configuration values */
  readonly defaultConfig = {
    coinPollingInterval: 6000
  }

  /**
   * Gets the current coin objects from the wallet
   *
   * @returns Array of coin objects owned by the wallet
   */
  public get coins() {
    return this._coins
  }

  /**
   * Gets the current portfolio information
   *
   * @returns UserPortfolio instance with current balance information
   */
  public get portfolio() {
    return this._portfolio
  }

  /**
   * Waits for the next portfolio update to complete
   *
   * @returns Promise that resolves when the portfolio is updated
   * @throws Error if no update promise is available
   */
  public async waitForUpdate() {
    if (!this._updatePromise) {
      throw new Error('Update promise not found')
    }
    return await this._updatePromise
  }

  /**
   * Sends a single coin to a recipient
   *
   * @param coinType - Type of coin to send
   * @param recipient - Recipient address
   * @param amount - Amount to send
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  public async sendCoin<T extends boolean = false>(
    coinType: string,
    recipient: string,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    return this.sendCoinBatch(coinType, [recipient], [amount], options)
  }

  /**
   * Sends coins to multiple recipients in a single transaction
   *
   * @param coinType - Type of coin to send
   * @param recipients - Array of recipient addresses
   * @param amounts - Array of amounts to send (must match recipients length)
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
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

    // Wait for latest portfolio update
    await this.waitForUpdate()

    // Check if sufficient balance is available
    const coinBalance = this.portfolio.getBalance(coinType)
    const totalAmount = amounts.reduce((acc, curr) => acc.plus(curr), BigNumber(0))
    if (coinBalance.amount.lt(totalAmount)) {
      throw new Error('Insufficient balance')
    }

    // Build transaction
    const tx = new Transaction()

    // Merge coins and split for recipients
    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: totalAmount.toNumber(),
      useGasCoin: true
    })

    const coins = tx.splitCoins(mergedCoin, amounts)

    // Transfer coins to recipients
    recipients.forEach((address, index) => {
      tx.transferObjects([coins[index]], address)
    })

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  /**
   * Transfers a single object to a recipient
   *
   * @param object - Object ID to transfer
   * @param recipient - Recipient address
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  async transferObject<T extends boolean = false>(
    object: string,
    recipient: string,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    return this.transferObjectBatch([object], [recipient], options)
  }

  /**
   * Transfers multiple objects to recipients in a single transaction
   *
   * @param objects - Array of object IDs to transfer
   * @param recipients - Array of recipient addresses (must match objects length)
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
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

    // Wait for latest portfolio update
    await this.waitForUpdate()

    // Build transaction
    const tx = new Transaction()

    // Transfer objects to recipients
    objects.forEach((object, index) => {
      tx.transferObjects([tx.object(object)], recipients[index])
    })

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  /**
   * Updates the portfolio with current coin information
   *
   * This function is wrapped with singleton behavior to prevent
   * concurrent updates and ensure data consistency.
   */
  updatePortfolio = withSingleton(async () => {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Fetch current coins from the wallet
    this._coins = await getUserCoins(this.walletClient.address, {
      client: this.walletClient.client
    })

    // Update portfolio with new coin data
    this._portfolio = new UserPortfolio(this._coins)

    // Emit portfolio update event
    this.emit('balance:portfolio-updated', {})
  })

  /** Current coin objects from the wallet */
  private _coins: CoinStruct[] = []

  /** Current portfolio information */
  private _portfolio: UserPortfolio = new UserPortfolio()

  /** Timer for polling balance updates */
  private pollingTimer: NodeJS.Timeout | null = null

  /** Promise for waiting on portfolio updates */
  private _updatePromise: Promise<void> | null = null

  /**
   * Starts the polling mechanism for balance updates
   *
   * This method recursively schedules itself to run at the configured
   * interval, ensuring regular balance updates.
   */
  private async startPolling() {
    try {
      await this.updatePortfolio()
    } catch (error) {
      console.error(error)
    } finally {
      this.pollingTimer = setTimeout(this.startPolling, this.config.coinPollingInterval)
    }
  }

  /**
   * Installs the balance module into a wallet client
   *
   * @param walletClient - The wallet client to install into
   */
  install(walletClient: WalletClient) {
    super.install(walletClient)

    // Bind the polling method and start polling
    this.startPolling = this.startPolling.bind(this)
    this.startPolling()

    // Create update promise for waiting on portfolio updates
    this._updatePromise = new Promise((resolve) => {
      walletClient.events.on('balance:portfolio-updated', () => {
        resolve()
      })
    })
  }

  /**
   * Uninstalls the balance module from the wallet client
   *
   * This method cleans up timers and stops polling to prevent memory leaks.
   */
  uninstall() {
    super.uninstall()
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
  }
}
