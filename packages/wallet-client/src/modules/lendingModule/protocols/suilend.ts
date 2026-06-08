import { LendingPool, LendingProtocol } from '.'
import { Transaction, TransactionObjectInput, TransactionResult } from '@mysten/sui/transactions'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@suilend/sdk/client'
import { parseObligation } from '@suilend/sdk/parsers/obligation'
import { parseReserve } from '@suilend/sdk/parsers/reserve'
import type { ObligationOwnerCap } from '@suilend/sdk/_generated/suilend/lending-market/structs'
import { WalletClient } from '../../../client'
import { getCoinMetadataMap } from '@suilend/sui-fe/lib/coinMetadata'
import { MAX_U64 } from '@suilend/sui-fe/lib/constants'
import BigNumber from 'bignumber.js'
import { normalizeStructTag } from '@mysten/sui/utils'

type SuilendProtocolCreateOptions = {
  grpcClient?: SuiGrpcClient
  grpcUrl?: string
}

function createSuilendGrpcClient(
  walletClient: WalletClient,
  options: SuilendProtocolCreateOptions
) {
  if (options.grpcClient) {
    return options.grpcClient
  }

  const network = walletClient.client.network
  const baseUrl =
    options.grpcUrl ??
    walletClient.clientUrl ??
    getJsonRpcFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet' | 'localnet')

  return new SuiGrpcClient({
    network,
    baseUrl
  })
}

class SuilendProtocol implements LendingProtocol {
  readonly name = 'suilend'
  private walletClient: WalletClient
  private obligationOwnerCap: ObligationOwnerCap<string>
  private suilendClient: SuilendClient

  constructor(
    walletClient: WalletClient,
    obligationOwnerCap: ObligationOwnerCap<string>,
    suilendClient: SuilendClient
  ) {
    this.walletClient = walletClient
    this.obligationOwnerCap = obligationOwnerCap
    this.suilendClient = suilendClient
  }

  static async create(walletClient: WalletClient, options: SuilendProtocolCreateOptions = {}) {
    const suilendGrpcClient = createSuilendGrpcClient(walletClient, options)
    const [suilendClient, obligations] = await Promise.all([
      SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, suilendGrpcClient),
      SuilendClient.getObligationOwnerCaps(
        walletClient.address,
        [LENDING_MARKET_TYPE],
        suilendGrpcClient
      )
    ])
    if (obligations.length === 0) {
      throw new Error('No existing obligations found for wallet address: ' + walletClient.address)
    }
    return new SuilendProtocol(walletClient, obligations[0], suilendClient)
  }

  async getPool(coinType: string): Promise<LendingPool & { cTokenExchangeRate: number }> {
    const normalizedCoinType = normalizeStructTag(coinType)

    const allReserves = this.suilendClient.lendingMarket.reserves

    const coinTypes = new Set<string>()

    allReserves.forEach((reserve) => {
      coinTypes.add(normalizeStructTag(reserve.coinType.name))
      reserve.depositsPoolRewardManager.poolRewards.forEach((reward) => {
        if (reward) {
          coinTypes.add(normalizeStructTag(reward.coinType.name))
        }
      })
      reserve.borrowsPoolRewardManager.poolRewards.forEach((reward) => {
        if (reward) {
          coinTypes.add(normalizeStructTag(reward.coinType.name))
        }
      })
    })

    const coinMetadataMap = await getCoinMetadataMap(Array.from(coinTypes))

    const parsedReserves = allReserves.map((reserve) => parseReserve(reserve, coinMetadataMap))
    const reservesMap = parsedReserves.reduce(
      (acc, reserve) => {
        acc[reserve.coinType] = reserve
        return acc
      },
      {} as Record<string, any>
    )

    const rawObligation = await this.suilendClient.getObligation(
      this.obligationOwnerCap.obligationId
    )

    const obligation = parseObligation(rawObligation, reservesMap)

    const deposit = obligation.deposits.find((deposit) => deposit.coinType === normalizedCoinType)
    const borrow = obligation.borrows.find((borrow) => borrow.coinType === normalizedCoinType)

    const decimals = coinMetadataMap[normalizedCoinType].decimals
    const cTokenExchangeRate = reservesMap[normalizedCoinType].cTokenExchangeRate.toNumber()

    return {
      cTokenExchangeRate: cTokenExchangeRate,
      supplyBalance: deposit?.depositedAmount.shiftedBy(decimals).decimalPlaces(0).toNumber() ?? 0,
      borrowBalance: borrow?.borrowedAmount.shiftedBy(decimals).decimalPlaces(0).toNumber() ?? 0,
      borrowAPR: reservesMap[normalizedCoinType].borrowAprPercent.toNumber()
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

  async withdrawCoinPTB(tx: Transaction, coinType: string, amount: number) {
    const pool = await this.getPool(coinType)
    const isMax = amount === pool.supplyBalance

    return await this.suilendClient.withdraw(
      this.obligationOwnerCap.id,
      this.obligationOwnerCap.obligationId,
      coinType,
      isMax ? MAX_U64.toString() : Math.ceil(amount / pool.cTokenExchangeRate).toString(),
      tx
    )
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
    coinObject: TransactionObjectInput,
    amount: number
  ): Promise<void> {
    this.suilendClient.repay(this.obligationOwnerCap.obligationId, coinType, coinObject, tx)
    tx.transferObjects([coinObject as any], tx.pure.address(this.walletClient.address))
  }
}

export default SuilendProtocol
