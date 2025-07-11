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
  depositCoinWithAccountCapPTB,
  withdrawCoinWithAccountCapPTB,
  liquidatePTB,
  claimLendingRewardsPTB,
  getUserAvailableLendingRewards,
  updateOraclePricesPTB,
  getPriceFeeds,
  getUserLendingState,
  filterPriceFeeds,
  CacheOption,
  LendingReward
} from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'

export interface LendingModuleConfig {
  env: 'dev' | 'prod'
}

export type Events = {
  'lending:deposit-success': {
    identifier: AssetIdentifier
    amount: number
  }
  'lending:withdraw-success': {
    identifier: AssetIdentifier
    amount: number
  }
  'lending:borrow-success': {
    identifier: AssetIdentifier
    amount: number
  }
  'lending:repay-success': {
    identifier: AssetIdentifier
    amount: number
  }
  'lending:liquidate-success': {
    payIdentifier: AssetIdentifier
    payAmount: number
    collateralIdentifier: AssetIdentifier
    liquidationAddress: string
  }
  'lending:claim-rewards-success': {
    rewards: LendingReward[]
  }
}

export class LendingModule extends Module<LendingModuleConfig, Events> {
  readonly name = 'lending'
  readonly defaultConfig: LendingModuleConfig = {
    env: 'prod'
  }

  async getPools(options?: Partial<CacheOption>) {
    return await getPools({
      env: this.config.env,
      ...options
    })
  }

  async getPool(identifier: AssetIdentifier, options?: Partial<CacheOption>) {
    return await getPool(identifier, {
      env: this.config.env,
      ...options
    })
  }

  async deposit<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    await this.walletClient.module('balance').waitForUpdate()

    const tx = new Transaction()

    const coinBalance = this.walletClient.module('balance').portfolio.getBalance(pool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: amount,
      useGasCoin: true
    })

    await depositCoinPTB(tx, pool, mergedCoin, {
      env: this.config.env,
      amount
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:deposit-success', {
        identifier,
        amount
      })

      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  async depositWithAccountCap<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    accountCapAddress: string,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    await this.walletClient.module('balance').waitForUpdate()

    const tx = new Transaction()

    const coinBalance = this.walletClient.module('balance').portfolio.getBalance(pool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: amount,
      useGasCoin: true
    })

    await depositCoinWithAccountCapPTB(tx, pool, mergedCoin, accountCapAddress, {
      env: this.config.env,
      amount
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  async withdraw<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    const tx = new Transaction()

    const coin = await withdrawCoinPTB(tx, pool, amount, {
      env: this.config.env
    })

    tx.transferObjects([coin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:withdraw-success', {
        identifier,
        amount
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  async withdrawWithAccountCap<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    accountCapAddress: string,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    const tx = new Transaction()

    const coin = await withdrawCoinWithAccountCapPTB(tx, pool, accountCapAddress, amount, {
      env: this.config.env
    })

    tx.transferObjects([coin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    return result as any
  }

  async borrow<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    const tx = new Transaction()

    const coin = await borrowCoinPTB(tx, pool, amount, {
      env: this.config.env
    })

    tx.transferObjects([coin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:borrow-success', {
        identifier,
        amount
      })
      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  async repay<T extends boolean = false>(
    identifier: AssetIdentifier,
    amount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    await this.walletClient.module('balance').waitForUpdate()

    const pool = await getPool(identifier, {
      env: this.config.env
    })

    const tx = new Transaction()

    const coinBalance = this.walletClient.module('balance').portfolio.getBalance(pool.suiCoinType)

    const mergedCoin = mergeCoinsPTB(tx, coinBalance.coins, {
      balance: amount,
      useGasCoin: true
    })

    await repayCoinPTB(tx, pool, mergedCoin, {
      env: this.config.env,
      amount
    })

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('lending:repay-success', {
        identifier,
        amount
      })

      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

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

  async claimAllRewards<T extends boolean = false>(options?: {
    dryRun: T
  }): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const tx = new Transaction()

    const rewards = await getUserAvailableLendingRewards(this.walletClient.address, {
      env: this.config.env
    })

    await claimLendingRewardsPTB(tx, rewards, {
      env: this.config.env
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
