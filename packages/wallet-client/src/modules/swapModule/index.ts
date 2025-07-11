import {
  buildSwapPTBFromQuote,
  getQuote,
  Dex,
  FeeOption,
  generateRefId
} from '@naviprotocol/astros-aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { Module } from '../module'
import { SuiTransactionBlockResponse, DryRunTransactionBlockResponse } from '@mysten/sui/client'
import BigNumber from 'bignumber.js'
import { mergeCoinsPTB } from '@naviprotocol/lending'

export interface SwapModuleConfig {
  apiKey: string
  baseUrl: string
  dexList: Dex[]
  depth: number
  serviceFee: FeeOption | undefined
  env: 'dev' | 'prod'
}

export type Events = {
  'swap:swap-success': {
    fromCoinType: string
    toCoinType: string
    fromAmount: number
    slippage: number
    toAmount: number
  }
}

export class SwapModule extends Module<SwapModuleConfig, Events> {
  readonly name = 'swap'
  readonly defaultConfig: SwapModuleConfig = {
    apiKey: '',
    baseUrl: 'https://open-aggregator-api.naviprotocol.io/find_routes',
    dexList: [],
    depth: 3,
    serviceFee: undefined,
    env: 'prod'
  }

  get referral() {
    return this.config.apiKey ? generateRefId(this.config.apiKey) : 0
  }

  async swap<T extends boolean = false>(
    fromCoinType: string,
    toCoinType: string,
    fromAmount: number,
    slippage: number,
    options?: { dryRun: T }
  ): Promise<T extends true ? DryRunTransactionBlockResponse : SuiTransactionBlockResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet client not found')
    }

    await this.walletClient.module('balance').waitForUpdate()

    const fromCoinBalance = this.walletClient.module('balance').portfolio.getBalance(fromCoinType)

    const tx = new Transaction()

    const fromCoin = mergeCoinsPTB(tx, fromCoinBalance.coins, {
      balance: fromAmount
    })

    const swapOptions = {
      baseUrl: this.config.baseUrl,
      dexList: this.config.dexList,
      depth: this.config.depth,
      serviceFee: this.config.serviceFee
    }

    const quote = await getQuote(
      fromCoinType,
      toCoinType,
      fromAmount,
      this.config.apiKey,
      swapOptions
    )

    const minAmountOut = new BigNumber(quote.amount_out).multipliedBy(1 - slippage).toFixed(0)

    const coinOut = await buildSwapPTBFromQuote(
      this.walletClient.address,
      tx,
      Number(minAmountOut),
      fromCoin as any,
      quote,
      this.referral,
      false,
      this.config.apiKey,
      swapOptions
    )

    tx.transferObjects([coinOut], this.walletClient.address)

    const result = await this.walletClient.signExecuteTransaction({
      transaction: tx,
      dryRun: options?.dryRun ?? false
    })

    if (!options?.dryRun && result.effects?.status?.status === 'success') {
      const slippageEvent = result.events?.find((event) => {
        return event.type.includes('::slippage::SwapEvent')
      })

      if (slippageEvent) {
        this.emit('swap:swap-success', {
          fromCoinType,
          toCoinType,
          fromAmount,
          slippage,
          toAmount: Number((slippageEvent.parsedJson as any).amount_out)
        })
      }

      this.walletClient.module('balance').updatePortfolio()
    }

    return result as any
  }
}
