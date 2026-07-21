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
import { getCoins, mergeCoinsPTB, withSingleton, listAddressBalances } from '@naviprotocol/lending'
import type { CoinStruct } from '@mysten/sui/jsonRpc'
import type { WalletClient } from '../../client'
import { UserPortfolio } from './portfolio'
import BigNumber from 'bignumber.js'
import { Transaction } from '@mysten/sui/transactions'
import type { NaviWalletTransactionResult } from '../../types'
import { normalizeStructTag } from '@mysten/sui/utils'

/**
 * Configuration options for the balance module
 */
export interface BalanceModuleConfig {
  /** Interval in milliseconds for polling coin balances */
  coinPollingInterval: number
  /** Whether to disable coin polling */
  disableCoinPolling: boolean
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
    coinPollingInterval: 6000,
    disableCoinPolling: false
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
  ): Promise<NaviWalletTransactionResult<T>> {
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
  ): Promise<NaviWalletTransactionResult<T>> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    if (recipients.length !== amounts.length) {
      throw new Error('Recipients and amounts must have the same length')
    }

    // Wait for latest portfolio update
    await this.waitForUpdate()

    // Check if sufficient balance is available. SUI is funded from the gas coin
    // below (address balance is not spendable on that path), so its sufficiency
    // counts coin objects only; other coins can redeem the address balance via
    // mergeCoinsPTB, so they count the combined total.
    const coinBalance = this.portfolio.getBalance(coinType)
    const isSui = normalizeStructTag(coinType) === normalizeStructTag('0x2::sui::SUI')
    const spendable = isSui ? coinBalance.amount : this.portfolio.combinedBalanceOf(coinType)
    const totalAmount = amounts.reduce((acc, curr) => acc.plus(curr), BigNumber(0))
    if (spendable.lt(totalAmount)) {
      throw new Error('Insufficient balance')
    }

    // Build transaction
    const tx = new Transaction()

    if (isSui) {
      // SUI: split each share from the gas coin; the leftover stays on the gas
      // coin, so there is no dangling zero-balance result.
      const shares = tx.splitCoins(tx.gas, amounts)
      recipients.forEach((address, index) => {
        tx.transferObjects([shares[index]], address)
      })
    } else {
      // Non-SUI: mergeCoinsPTB returns a coin holding EXACTLY totalAmount. It may
      // be a redeem_funds result (address balance) with no owned object to
      // absorb leftover, so a plain splitCoins of every share would leave the
      // source at zero balance and unused (Coin has no `drop` ability → PTB
      // fails). Instead split the first n-1 shares and transfer the source coin
      // itself as the last share, fully consuming it.
      const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
        balance: totalAmount.toNumber(),
        addressBalance: coinBalance.addressBalance.toFixed(0),
        coinType
      })
      if (recipients.length === 1) {
        tx.transferObjects([mergedCoin], recipients[0])
      } else {
        const headShares = tx.splitCoins(mergedCoin, amounts.slice(0, -1))
        recipients.slice(0, -1).forEach((address, index) => {
          tx.transferObjects([headShares[index]], address)
        })
        tx.transferObjects([mergedCoin], recipients[recipients.length - 1])
      }
    }

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
  ): Promise<NaviWalletTransactionResult<T>> {
    return this.transferObjectBatch([object], [recipient], options)
  }

  /**
   * Transfers multiple objects to their respective recipients in a single transaction
   *
   * Each object is transferred to its corresponding recipient by index
   * (first object → first recipient, second object → second recipient, etc.)
   *
   * @param objects - Object IDs to transfer
   * @param recipients - Recipient addresses (must match objects array length)
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  async transferObjectBatch<T extends boolean = false>(
    objects: string[],
    recipients: string[],
    options?: { dryRun: T }
  ): Promise<NaviWalletTransactionResult<T>> {
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
    this._coins = await getCoins(this.walletClient.address, {
      client: this.walletClient.client
    })

    // Also fetch funds held at the address level (v2 address balances). Coin
    // objects only cover `Coin<T>` objects, so this map lets sufficiency checks
    // and coin selection see the full spendable total.
    const addressBalances = await this.getAddressBalanceMap()

    // Update portfolio with new coin data
    this._portfolio = new UserPortfolio(this._coins, addressBalances)

    // Emit portfolio update event
    this.emit('balance:portfolio-updated', {})
  })

  /**
   * Builds a map of coin type to address-level balance (v2 address balances).
   *
   * Feature-detects the v2 Core balance API on the injected client; when it is
   * unavailable (legacy JSON-RPC only), returns an empty map so the portfolio
   * falls back to coin-object-only behavior.
   *
   * @returns Map of normalized coin type to address balance (atomic units)
   */
  private async getAddressBalanceMap(): Promise<{ [key in string]?: string }> {
    const map: { [key in string]?: string } = {}
    if (!this.walletClient) {
      return map
    }
    const core = (this.walletClient.client as { core?: Record<string, unknown> }).core
    if (typeof core?.listBalances !== 'function' || typeof core?.getBalance !== 'function') {
      return map
    }
    try {
      let cursor: string | null | undefined = null
      do {
        const { balances, nextCursor } = await listAddressBalances(this.walletClient.client, {
          owner: this.walletClient.address,
          cursor,
          limit: 100
        })
        for (const balance of balances) {
          // Only track coin types that actually hold funds at the address level
          // to avoid creating empty portfolio entries.
          if (balance.addressBalance && balance.addressBalance !== '0') {
            map[balance.coinType] = balance.addressBalance
          }
        }
        cursor = nextCursor
      } while (cursor)
    } catch (error) {
      console.error(error)
    }
    return map
  }

  /** Current coin objects from the wallet */
  private _coins: CoinStruct[] = []

  /** Current portfolio information */
  private _portfolio: UserPortfolio = new UserPortfolio()

  /** Timer for polling balance updates */
  private pollingTimer: NodeJS.Timeout | null = null

  /** Promise for waiting on portfolio updates */
  private _updatePromise: Promise<void> | null = null

  /**
   * Starts polling for portfolio updates
   *
   * This method recursively schedules itself to run at the configured
   * interval, ensuring regular balance updates.
   */
  private async startPolling() {
    if (this.config.disableCoinPolling) {
      return
    }

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
   * @param walletClient - The wallet client instance to install into
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
