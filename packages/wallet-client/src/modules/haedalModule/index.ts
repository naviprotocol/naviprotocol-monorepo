/**
 * Haedal Staking Module
 *
 * This module provides staking and unstaking functionality for the Haedal protocol.
 * It allows users to stake SUI for haSUI and unstake haSUI back to SUI, and fetches APY stats.
 *
 * @module HaedalModule
 */

import {
  CoinObject,
  mergeCoinsPTB,
  parseTxVaule,
  withCache,
  withSingleton
} from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'
import { Module } from '../module'
import { SuiTransactionBlockResponse, DryRunTransactionBlockResponse } from '@mysten/sui/client'

/**
 * Configuration for the Haedal module
 */
export interface HaedalModuleConfig {
  /** Haedal package ID on Sui */
  packageId: string
  /** Haedal config object ID */
  configId: string
  /** haSUI coin type */
  coinType: string
}

/**
 * Events emitted by the Haedal module
 */
export type Events = {
  /** Emitted when staking SUI is successful */
  'haedal:stake-success': {
    suiAmount: number
  }
  /** Emitted when unstaking haSUI is successful */
  'haedal:unstake-success': {
    haSUIAmount: number
  }
}

/**
 * Haedal staking/unstaking module for wallet client
 */
export class HaedalModule extends Module<HaedalModuleConfig, Events> {
  /** Module name identifier */
  readonly name = 'haedal'
  /** Default configuration values */
  readonly defaultConfig = {
    packageId: '0x3f45767c1aa95b25422f675800f02d8a813ec793a00b60667d071a77ba7178a2',
    configId: '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca',
    coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI'
  }

  /**
   * Fetches the current APY for Haedal staking
   */
  getApy = withCache(
    withSingleton(async () => {
      const resp: {
        data: {
          apy: number
        }
      } = await fetch('https://open-api.naviprotocol.io/api/haedal/stats').then((res) => res.json())

      return resp.data.apy
    })
  )

  /**
   * Builds a transaction block for staking SUI to haSUI
   */
  async stakePTB(tx: Transaction, suiCoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::staking::request_stake_coin`,
      arguments: [
        tx.object('0x05'),
        tx.object(this.config.configId),
        parseTxVaule(suiCoin, tx.object),
        tx.pure.address('0x0000000000000000000000000000000000000000000000000000000000000000')
      ],
      typeArguments: []
    })
    return coin
  }

  /**
   * Builds a transaction block for unstaking haSUI to SUI
   */
  async unstakePTB(tx: Transaction, haSUICoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::staking::request_unstake_instant_coin`,
      arguments: [
        tx.object('0x05'),
        tx.object(this.config.configId),
        parseTxVaule(haSUICoin, tx.object)
      ],
      typeArguments: []
    })
    return coin
  }

  /**
   * Stake SUI for haSUI
   * @param suiAmount Amount of SUI to stake
   * @param options Optional dry run
   */
  async stake<T extends boolean = false>(
    suiAmount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    const tx = new Transaction()
    await this.walletClient.module('balance').waitForUpdate()
    const suiBalance = this.walletClient.module('balance').portfolio.getBalance('0x2::sui::SUI')
    const mergedCoin = mergeCoinsPTB(tx, suiBalance.coins, {
      balance: suiAmount,
      useGasCoin: true
    })
    const coin = tx.splitCoins(mergedCoin, [tx.pure.u64(suiAmount)])
    const haSUICoin = await this.stakePTB(tx, coin)
    tx.transferObjects([haSUICoin], this.walletClient.address)
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('haedal:stake-success', { suiAmount })
      this.walletClient.module('balance').updatePortfolio()
    }
    return result as any
  }

  /**
   * Unstake haSUI for SUI
   * @param haSUIAmount Amount of haSUI to unstake
   * @param options Optional dry run
   */
  async unstake<T extends boolean = false>(
    haSUIAmount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }
    await this.walletClient.module('balance').waitForUpdate()
    const tx = new Transaction()
    const haSuiBalance = this.walletClient
      .module('balance')
      .portfolio.getBalance(this.config.coinType)
    const mergedCoin = mergeCoinsPTB(tx, haSuiBalance.coins, {
      balance: haSUIAmount
    })
    const suiCoin = await this.unstakePTB(tx, mergedCoin)
    tx.transferObjects([suiCoin], this.walletClient.address)
    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })
    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('haedal:unstake-success', { haSUIAmount })
      this.walletClient.module('balance').updatePortfolio()
    }
    return result as any
  }
}
