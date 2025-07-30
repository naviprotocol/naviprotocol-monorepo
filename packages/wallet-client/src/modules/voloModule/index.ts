/**
 * Volo Module for Sui Staking Protocol Integration
 *
 * This module provides functionality to interact with the Volo staking protocol on Sui.
 * Volo allows users to stake SUI tokens and receive vSUI (volo SUI) tokens in return,
 * enabling liquid staking with potential rewards and instant unstaking capabilities.
 */

import {
  CoinObject,
  mergeCoinsPTB,
  parseTxValue,
  withCache,
  withSingleton
} from '@naviprotocol/lending'
import { Transaction } from '@mysten/sui/transactions'
import { Module } from '../module'
import { SuiTransactionBlockResponse, DryRunTransactionBlockResponse } from '@mysten/sui/client'

/**
 * Configuration interface for the Volo staking module
 */
export interface VoloModuleConfig {
  /** The package ID of the Volo staking contract */
  packageId: string
  /** The pool ID for the staking pool */
  poolId: string
  /** The coin type for vSUI tokens */
  coinType: string
  /** The metadata ID for the staking pool */
  metadataId: string
}

/**
 * Event types emitted by the Volo module
 */
export type Events = {
  /** Emitted when staking is successful */
  'volo:stake-success': {
    /** Amount of SUI staked */
    suiAmount: number
  }
  /** Emitted when unstaking is successful */
  'volo:unstake-success': {
    /** Amount of vSUI unstaked */
    vSuiAmount: number
  }
}

/**
 * Statistics and information about the Volo staking pool
 */
export type VoloStats = {
  /** Current operator balance */
  operatorBalance: string
  /** Collectable fees in the pool */
  collectableFee: string
  /** Pending stakes waiting to be processed */
  pendingStakes: string
  /** Total amount staked in the pool */
  totalStaked: string
  /** Total rewards distributed to stakers */
  totalRewardsInStakes: string
  /** Currently active stake amount */
  activeStake: string
  /** Current epoch number */
  currentEpoch: string
  /** List of validators in the pool */
  validators: {
    /** Validator address */
    address: string
    /** Total amount staked with this validator */
    totalStaked: string
    /** Assigned weight for this validator */
    assigned_weight: string
    /** Annual percentage yield for this validator */
    apy: string
    /** Validator name */
    name: string
  }[]
  /** Current exchange rate between SUI and vSUI */
  exchangeRate: number
  /** Total supply of vSUI tokens */
  totalSupply: string
  /** Overall APY for the staking pool */
  apy: number
  /** Maximum amount that can be instantly unstaked */
  maxInstantUnstake: string
  /** Maximum amount that can be unstaked without fees */
  maxNoFeeUnstake: string
  /** Total number of stakers in the pool */
  totalStakers: number
  /** Timestamp of last update */
  lastUpdated: number
}

/**
 * Volo Module for Sui Staking Protocol
 *
 * Provides functionality to stake SUI tokens and receive vSUI tokens,
 * enabling liquid staking with potential rewards and instant unstaking.
 */
export class VoloModule extends Module<VoloModuleConfig, Events> {
  /** Module name identifier */
  readonly name = 'volo'

  /** Default configuration for the Volo staking protocol */
  readonly defaultConfig = {
    packageId: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
    poolId: '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
    metadataId: '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60',
    coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
  }

  /**
   * Get current statistics and information about the Volo staking pool
   * Uses caching to avoid repeated API calls
   *
   * @returns Volo staking pool information
   */
  getStats = withCache(
    withSingleton(async () => {
      const resp: {
        data: VoloStats
      } = await fetch('https://open-api.naviprotocol.io/api/volo/stats').then((res) => res.json())

      return resp.data
    })
  )

  /**
   * Adds staking operation to a transaction black
   *
   * @param tx - The transaction block to add the staking operation to
   * @param suiCoin - The SUI coin object to stake
   * @returns The vSUI coin object received from staking
   */
  async stakePTB(tx: Transaction, suiCoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::stake_pool::stake`,
      arguments: [
        tx.object(this.config.poolId),
        tx.object(this.config.metadataId),
        tx.object('0x05'),
        parseTxValue(suiCoin, tx.object)
      ],
      typeArguments: []
    })
    return coin
  }

  /**
   * Adds unstaking operation to a transaction black
   *
   * @param tx - The transaction block to add the unstaking operation to
   * @param vSuiCoin - The vSUI coin object to unstake
   * @returns The SUI coin object received from unstaking
   */
  async unstakePTB(tx: Transaction, vSuiCoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::stake_pool::unstake`,
      arguments: [
        tx.object(this.config.poolId),
        tx.object(this.config.metadataId),
        tx.object('0x05'),
        parseTxValue(vSuiCoin, tx.object)
      ],
      typeArguments: []
    })
    return coin
  }

  /**
   * Stake SUI tokens to receive vSUI tokens
   *
   * @param suiAmount - Amount of SUI to stake (in MIST units)
   * @param options - Optional parameters including dryRun flag
   * @returns Transaction response or dry run response
   * @throws Error if wallet client not found or stake amount is too low
   */
  async stake<T extends boolean = false>(
    suiAmount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    if (suiAmount < 1e9) {
      throw new Error('Stake amount should be greater than 1Sui')
    }

    const tx = new Transaction()

    await this.walletClient.module('balance').waitForUpdate()

    const suiBalance = this.walletClient.module('balance').portfolio.getBalance('0x2::sui::SUI')

    const mergedCoin = mergeCoinsPTB(tx, suiBalance.coins, {
      balance: suiAmount,
      useGasCoin: true
    })

    const vSuiCoin = await this.stakePTB(tx, mergedCoin)

    tx.transferObjects([vSuiCoin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('volo:stake-success', {
        suiAmount
      })

      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }

  /**
   * Unstake vSUI tokens to receive SUI tokens
   *
   * @param vSuiAmount - Amount of vSUI to unstake (in MIST units)
   * @param options - Optional parameters including dryRun flag
   * @returns Transaction response or dry run response
   * @throws Error if wallet client not found or unstake amount is too low
   */
  async unstake<T extends boolean = false>(
    vSuiAmount: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    if (vSuiAmount < 1e9) {
      throw new Error('Unstake amount should >= 1vSui')
    }

    await this.walletClient.module('balance').waitForUpdate()

    const tx = new Transaction()

    const vSuiBalance = this.walletClient
      .module('balance')
      .portfolio.getBalance(this.config.coinType)

    const mergedCoin = mergeCoinsPTB(tx, vSuiBalance.coins, {
      balance: vSuiAmount
    })

    const suiCoin = await this.unstakePTB(tx, mergedCoin)

    tx.transferObjects([suiCoin], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      this.emit('volo:unstake-success', {
        vSuiAmount
      })

      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }
}
