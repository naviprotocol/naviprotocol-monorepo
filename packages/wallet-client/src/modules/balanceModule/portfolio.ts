/**
 * User Portfolio Management
 *
 * This module provides portfolio management functionality for tracking
 * user coin balances across different token types. It aggregates coin
 * objects by type and provides convenient methods for balance queries
 * and portfolio operations.
 *
 * @module UserPortfolio
 */

import { CoinStruct } from '@mysten/sui/client'
import { BigNumber } from 'bignumber.js'
import { normalizeStructTag } from '@mysten/sui/utils'

/**
 * User portfolio for managing coin balances
 *
 * This class provides functionality to:
 * - Aggregate coins by type and calculate total balances
 * - Query balances for specific coin types
 * - Clone portfolio state for safe operations
 * - Normalize coin types for consistent comparison
 */
export class UserPortfolio {
  /** Mapping of coin types to their balance information */
  balances: { [key in string]: UserCoinBalance }

  /**
   * Creates a new user portfolio
   *
   * @param coins - Array of coin objects or existing portfolio to copy from
   */
  constructor(coins?: CoinStruct[] | UserPortfolio) {
    if (coins instanceof UserPortfolio) {
      // Copy from existing portfolio
      this.balances = JSON.parse(JSON.stringify(coins.balances))
    } else {
      // Build portfolio from coin objects
      const balances: { [key in string]: UserCoinBalance } = {}

      coins?.forEach((item) => {
        // Normalize coin type for consistent key usage
        const normalizedCoinType = normalizeStructTag(item.coinType)
        let existPofolio = balances[normalizedCoinType]

        // Create new balance entry if it doesn't exist
        if (!existPofolio) {
          existPofolio = {
            coinType: normalizedCoinType,
            amount: BigNumber(0),
            coins: []
          }
          balances[normalizedCoinType] = existPofolio
        }

        // Add coin to balance and update total amount
        existPofolio.coins.push(item)
        existPofolio.amount = existPofolio.amount.plus(item.balance)
      })

      this.balances = balances
    }
  }

  /**
   * Gets balance information for a specific coin type
   *
   * @param coinType - The coin type to query
   * @returns UserCoinBalance object with coin type, total amount, and coin objects
   */
  getBalance(coinType: string): UserCoinBalance {
    coinType = normalizeStructTag(coinType)
    return this.balances[coinType] || { coinType, amount: BigNumber(0), coins: [] }
  }

  /**
   * Gets all coin types in the portfolio
   *
   * @returns Array of coin type strings
   */
  getCoinTypes() {
    return Object.values(this.balances).map((item) => {
      return item.coinType
    })
  }

  /**
   * Gets the total balance amount for a specific coin type
   *
   * @param coinType - The coin type to query
   * @returns BigNumber representing the total balance
   */
  balanceOf(coinType: string) {
    coinType = normalizeStructTag(coinType)
    const balance = this.getBalance(coinType)
    return balance?.amount || BigNumber(0)
  }

  /**
   * Creates a deep copy of the portfolio
   *
   * This method creates a completely independent copy of the portfolio
   * that can be modified without affecting the original.
   *
   * @returns New UserPortfolio instance with copied data
   */
  clone() {
    const newBalances = JSON.parse(JSON.stringify(this.balances))
    const userPortfolio = new UserPortfolio()
    userPortfolio.balances = newBalances
    return userPortfolio
  }
}

/**
 * Balance information for a specific coin type
 *
 * This type represents the aggregated balance information for all
 * coins of a particular type in the user's portfolio.
 */
export type UserCoinBalance = {
  /** Normalized coin type string */
  coinType: string
  /** Total balance amount across all coins of this type */
  amount: BigNumber
  /** Array of individual coin objects */
  coins: CoinStruct[]
}
