import { CoinStruct } from '@mysten/sui/client'
import { BigNumber } from 'bignumber.js'
import { normalizeStructTag } from '@mysten/sui/utils'

export class UserPortfolio {
  balances: { [key in string]: UserCoinBalance }

  constructor(coins?: CoinStruct[] | UserPortfolio) {
    if (coins instanceof UserPortfolio) {
      this.balances = JSON.parse(JSON.stringify(coins.balances))
    } else {
      const balances: { [key in string]: UserCoinBalance } = {}
      coins?.forEach((item) => {
        let existPofolio = balances[normalizeStructTag(item.coinType)]
        if (!existPofolio) {
          existPofolio = {
            coinType: normalizeStructTag(item.coinType),
            amount: BigNumber(0),
            coins: []
          }
          balances[normalizeStructTag(item.coinType)] = existPofolio
        }
        existPofolio.coins.push(item)
        existPofolio.amount = existPofolio.amount.plus(item.balance)
      })
      this.balances = balances
    }
  }

  getBalance(coinType: string): UserCoinBalance {
    coinType = normalizeStructTag(coinType)
    return this.balances[coinType] || { coinType, amount: BigNumber(0), coins: [] }
  }

  getCoinTypes() {
    return Object.values(this.balances).map((item) => {
      return item.coinType
    })
  }

  balanceOf(coinType: string) {
    coinType = normalizeStructTag(coinType)
    const balance = this.getBalance(coinType)
    return balance?.amount || BigNumber(0)
  }

  clone() {
    const newBalances = JSON.parse(JSON.stringify(this.balances))
    const userPortfolio = new UserPortfolio()
    userPortfolio.balances = newBalances
    return userPortfolio
  }
}

export type UserCoinBalance = {
  coinType: string
  amount: BigNumber
  coins: CoinStruct[]
}
