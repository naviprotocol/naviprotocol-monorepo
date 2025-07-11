/**
 * Lending Module Implementation
 *
 * This module provides comprehensive lending protocol functionality for the wallet client.
 * It handles deposit, withdraw, borrow, repay operations, liquidation, reward claiming,
 * and oracle price updates for the Navi lending protocol.
 *
 * @module LendingModule
 */

import { DryRunTransactionBlockResponse, SuiTransactionBlockResponse } from '@mysten/sui/client'
import { Module } from '../module'
import {
  depositCoinPTB,
  withdrawCoinPTB,
  borrowCoinPTB,
  repayCoinPTB,
  AssetIdentifier,
  getPool,
  getPools,
  mergeCoinsPTB,
  getUserHealthFactor,
  liquidatePTB,
  claimLendingRewardsPTB,
  getUserAvailableLendingRewards,
  updateOraclePricesPTB,
  getPriceFeeds,
  getUserLendingState,
  filterPriceFeeds,
  CacheOption,
  LendingReward,
  AccountCapOption
} from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

/**
 * Configuration options for the lending module
 */
export interface LendingModuleConfig {
  /** Environment setting for protocol interaction */
  env: 'dev' | 'prod'
}

/**
 * Events emitted by the lending module
 */
export type Events = {
  /** Emitted when a deposit is successfully completed */
  'lending:deposit-success': {
    /** Asset identifier for the deposited asset */
    identifier: AssetIdentifier
    /** Amount deposited */
    amount: number
  }
  /** Emitted when a withdrawal is successfully completed */
  'lending:withdraw-success': {
    /** Asset identifier for the withdrawn asset */
    identifier: AssetIdentifier
    /** Amount withdrawn */
    amount: number
  }
  /** Emitted when a borrow is successfully completed */
  'lending:borrow-success': {
    /** Asset identifier for the borrowed asset */
    identifier: AssetIdentifier
    /** Amount borrowed */
    amount: number
  }
  /** Emitted when a repayment is successfully completed */
  'lending:repay-success': {
    /** Asset identifier for the repaid asset */
    identifier: AssetIdentifier
    /** Amount repaid */
    amount: number
  }
  /** Emitted when a liquidation is successfully completed */
  'lending:liquidate-success': {
    /** Asset identifier for the debt being paid */
    payIdentifier: AssetIdentifier
    /** Amount of debt paid */
    payAmount: number
    /** Asset identifier for the collateral being liquidated */
    collateralIdentifier: AssetIdentifier
    /** Address of the account being liquidated */
    liquidationAddress: string
  }
  /** Emitted when rewards are successfully claimed */
  'lending:claim-rewards-success': {
    /** Array of claimed rewards */
    rewards: LendingReward[]
  }
}

/**
 * Lending protocol module for wallet operations
 *
 * This module provides comprehensive lending functionality including:
 * - Deposit and withdraw operations
 * - Borrow and repay operations
 * - Liquidation functionality
 * - Reward claiming
 * - Oracle price updates
 * - Health factor monitoring
 * - Pool information retrieval
 */
export class LendingModule extends Module<LendingModuleConfig, Events> {
  /** Module name identifier */
  readonly name = 'lending'

  /** Default configuration values */
  readonly defaultConfig: LendingModuleConfig = {
    env: 'prod'
  }

  /**
   * Gets all available lending pools
   *
   * @param options - Optional caching options
   * @returns Array of pool information
   */
  async getPools(options?: Partial<CacheOption>) {
    return await getPools({
      env: this.config.env,
      ...options
    })
  }

  /**
   * Gets information for a specific lending pool
   *
   * @param identifier - Asset identifier (string, Pool object, or number)
   * @param options - Optional caching options
   * @returns Pool information
   */
  async getPool(identifier: AssetIdentifier, options?: Partial<CacheOption>) {
    return await getPool(identifier, {
      env: this.config.env,
      ...options
    })
  }

  /**
   * Deposits coins into a lending pool
   *
   * @param identifier - Asset identifier for the pool
   * @param amount - Amount to deposit
   * @param options - Optional parameters including dry run mode and account capability
   * @returns Transaction response or dry run response
   */
  async deposit<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T } & Partial<AccountCapOption>
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Get pool information
    const pool = await getPool(identifier, {
      env: this.config.env
    })

    // Wait for latest balance update
    await this.walletClient.module('balance').waitForUpdate()

    // Build transaction
    const tx = new Transaction()

    // Get coin balance and merge coins for deposit
    const coinBalance = this.walletClient.module('balance').portfolio.getBalance(pool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: amount,
      useGasCoin: true
    })

    // Build deposit transaction
    await depositCoinPTB(tx, pool, mergedCoin, {
      env: this.config.env,
      amount,
      accountCap: options?.accountCap
    })

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    // Handle successful deposit
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:deposit-success', {
        identifier,
        amount
      })

      // Update balance portfolio
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Withdraws coins from a lending pool
   *
   * @param identifier - Asset identifier for the pool
   * @param amount - Amount to withdraw
   * @param options - Optional parameters including dry run mode and account capability
   * @returns Transaction response or dry run response
   */
  async withdraw<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T } & Partial<AccountCapOption>
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Get pool information
    const pool = await getPool(identifier, {
      env: this.config.env
    })

    // Build transaction
    const tx = new Transaction()

    // Build withdraw transaction
    const coin = await withdrawCoinPTB(tx, pool, amount, {
      env: this.config.env,
      accountCap: options?.accountCap
    })

    // Transfer withdrawn coins to wallet
    tx.transferObjects([coin], this.walletClient.address)

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    // Handle successful withdrawal
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:withdraw-success', {
        identifier,
        amount
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Borrows coins from a lending pool
   *
   * @param identifier - Asset identifier for the pool
   * @param amount - Amount to borrow
   * @param options - Optional parameters including dry run mode and account capability
   * @returns Transaction response or dry run response
   */
  async borrow<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T } & Partial<AccountCapOption>
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Get pool information
    const pool = await getPool(identifier, {
      env: this.config.env
    })

    // Build transaction
    const tx = new Transaction()

    // Build borrow transaction
    const coin = await borrowCoinPTB(tx, pool, amount, {
      env: this.config.env,
      accountCap: options?.accountCap
    })

    // Transfer borrowed coins to wallet
    tx.transferObjects([coin], this.walletClient.address)

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    // Handle successful borrow
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:borrow-success', {
        identifier,
        amount
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Repays borrowed coins to a lending pool
   *
   * @param identifier - Asset identifier for the pool
   * @param amount - Amount to repay
   * @param options - Optional parameters including dry run mode and account capability
   * @returns Transaction response or dry run response
   */
  async repay<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T } & Partial<AccountCapOption>
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    // Wait for latest balance update
    await this.walletClient.module('balance').waitForUpdate()

    // Get pool information
    const pool = await getPool(identifier, {
      env: this.config.env
    })

    // Build transaction
    const tx = new Transaction()

    // Get coin balance and merge coins for repayment
    const coinBalance = this.walletClient.module('balance').portfolio.getBalance(pool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: amount,
      useGasCoin: true
    })

    // Build repay transaction
    await repayCoinPTB(tx, pool, mergedCoin, {
      env: this.config.env,
      amount,
      accountCap: options?.accountCap
    })

    // Execute transaction
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    // Handle successful repayment
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:repay-success', {
        identifier,
        amount
      })

      // Update balance portfolio
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Gets the current health factor for the user
   *
   * @returns Current health factor value
   */
  async getHealthFactor() {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const address = this.walletClient.address

    const healthFactor = await getUserHealthFactor(address, {
      env: this.config.env,
      client: this.walletClient.client
    })

    return healthFactor
  }

  /**
   * Initiates a liquidation process
   *
   * @param payIdentifier - Asset identifier for the debt being paid
   * @param payAmount - Amount of debt to pay
   * @param collateralIdentifier - Asset identifier for the collateral being liquidated
   * @param liquidationAddress - Address of the account being liquidated
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  async liquidate<T extends boolean = false>(
    payIdentifier: AssetIdentifier,
    payAmount: number,
    collateralIdentifier: AssetIdentifier,
    liquidationAddress: string,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const payPool = await getPool(payIdentifier, {
      env: this.config.env
    })
    const collateralPool = await getPool(collateralIdentifier, {
      env: this.config.env
    })

    const tx = new Transaction()

    const payCoinBalance = this.walletClient
      .module('balance')
      .portfolio.getBalance(payPool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, payCoinBalance.coins, {
      balance: payAmount,
      useGasCoin: true
    })

    const [collateralBalance, remainDebtBalance] = await liquidatePTB(
      tx,
      payPool,
      mergedCoin,
      collateralPool,
      liquidationAddress,
      {
        env: this.config.env
      }
    )

    const [collateralCoin] = tx.moveCall({
      target: `0x2::coin::from_balance`,
      arguments: [collateralBalance],
      typeArguments: [collateralPool.suiCoinType]
    })

    const [leftDebtCoin] = tx.moveCall({
      target: `0x2::coin::from_balance`,
      arguments: [remainDebtBalance],
      typeArguments: [payPool.suiCoinType]
    })

    tx.transferObjects([collateralCoin, leftDebtCoin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:liquidate-success', {
        payIdentifier,
        payAmount,
        collateralIdentifier,
        liquidationAddress
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Claims all available lending rewards for the user
   *
   * @param options - Optional parameters including dry run mode and account capability
   * @returns Transaction response or dry run response
   */
  async claimAllRewards<T extends boolean = false>(
    options?: { dryRun: T } & Partial<AccountCapOption>
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const tx = new Transaction()

    const rewards = await getUserAvailableLendingRewards(this.walletClient.address, {
      env: this.config.env
    })

    await claimLendingRewardsPTB(tx, rewards, {
      env: this.config.env,
      accountCap: options?.accountCap
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:claim-rewards-success', {
        rewards
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Updates the oracle prices for the lending protocol
   *
   * @param options - Optional parameters including dry run mode
   * @returns Transaction response or dry run response
   */
  async updateOracle<T extends boolean = false>(options?: {
    dryRun: T
  }): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const tx = new Transaction()

    const feeds = await getPriceFeeds({
      env: this.config.env
    })

    const lendingState = await this.getUserLendingState({
      cacheTime: 60 * 1000
    })

    const filteredFeeds = filterPriceFeeds(feeds, {
      lendingState
    })

    await updateOraclePricesPTB(tx, filteredFeeds, {
      env: this.config.env,
      updatePythPriceFeeds: true
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  /**
   * Gets the current lending state for the user
   *
   * @param options - Optional caching options
   * @returns User's lending state information
   */
  async getUserLendingState(options?: Partial<CacheOption>) {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    return await getUserLendingState(this.walletClient.address, {
      env: this.config.env,
      client: this.walletClient.client,
      ...options
    })
  }
}
