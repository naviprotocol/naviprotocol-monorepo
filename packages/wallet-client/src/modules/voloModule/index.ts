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
import axios from 'axios'

export interface VoloModuleConfig {
  packageId: string
  poolId: string
  coinType: string
  metadataId: string
}

export type Events = {
  'volo:stake-success': {
    suiAmount: number
  }
  'volo:unstake-success': {
    vSuiAmount: number
  }
}

export type VoloStats = {
  operatorBalance: string
  collectableFee: string
  pendingStakes: string
  totalStaked: string
  totalRewardsInStakes: string
  activeStake: string
  currentEpoch: string
  validators: {
    address: string
    totalStaked: string
    assigned_weight: string
    apy: string
    name: string
  }[]
  exchangeRate: number
  totalSupply: string
  apy: number
  maxInstantUnstake: string
  maxNoFeeUnstake: string
  totalStakers: number
  lastUpdated: number
}

export class VoloModule extends Module<VoloModuleConfig, Events> {
  readonly name = 'volo'
  readonly defaultConfig = {
    packageId: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
    poolId: '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
    metadataId: '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60',
    coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
  }

  getStats = withCache(
    withSingleton(async () => {
      const resp: {
        data: VoloStats
      } = await axios.get('https://open-api.naviprotocol.io/api/volo/stats').then((res) => {
        return res.data
      })
      return resp.data
    })
  )

  async stakePTB(tx: Transaction, suiCoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::stake_pool::stake`,
      arguments: [
        tx.object(this.config.poolId),
        tx.object(this.config.metadataId),
        tx.object('0x05'),
        parseTxVaule(suiCoin, tx.object)
      ],
      typeArguments: []
    })
    return coin
  }

  async unstakePTB(tx: Transaction, vSuiCoin: CoinObject) {
    const [coin] = tx.moveCall({
      target: `${this.config.packageId}::stake_pool::unstake`,
      arguments: [
        tx.object(this.config.poolId),
        tx.object(this.config.metadataId),
        tx.object('0x05'),
        parseTxVaule(vSuiCoin, tx.object)
      ],
      typeArguments: []
    })
    return coin
  }

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

    const coin = tx.splitCoins(mergedCoin, [tx.pure.u64(suiAmount)])

    const vSuiCoin = await this.stakePTB(tx, coin)

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
