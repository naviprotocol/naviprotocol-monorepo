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

import type { CoinStruct } from '@mysten/sui/jsonRpc'
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
   * @param addressBalances - Optional map of normalized coin type to funds held
   *   directly at the address level (v2 address balances). Coin objects only
   *   account for `Coin<T>` objects, so this carries the balance that lives at
   *   the address and is not represented by any object. Defaults to empty,
   *   which preserves legacy coin-object-only behavior.
   */
  constructor(
    coins?: CoinStruct[] | UserPortfolio,
    addressBalances?: { [key in string]?: BigNumber.Value }
  ) {
    if (coins instanceof UserPortfolio) {
      // Copy from existing portfolio
      this.balances = JSON.parse(JSON.stringify(coins.balances))
      // JSON round-trips BigNumber to string, so rehydrate BigNumber fields.
      Object.values(this.balances).forEach((balance) => {
        balance.amount = BigNumber(balance.amount)
        balance.addressBalance = BigNumber(balance.addressBalance ?? 0)
      })
    } else {
      // Build portfolio from coin objects
      const balances: { [key in string]: UserCoinBalance } = {}

      coins?.forEach((item) => {
        if (!item.coinType || item.balance === undefined || item.balance === null) {
          return
        }
        // Normalize coin type for consistent key usage
        const normalizedCoinType = normalizeStructTag(item.coinType)
        let existPofolio = balances[normalizedCoinType]

        // Create new balance entry if it doesn't exist
        if (!existPofolio) {
          existPofolio = {
            coinType: normalizedCoinType,
            amount: BigNumber(0),
            addressBalance: BigNumber(0),
            coins: []
          }
          balances[normalizedCoinType] = existPofolio
        }

        // Add coin to balance and update total amount
        existPofolio.coins.push(item)
        existPofolio.amount = existPofolio.amount.plus(item.balance)
      })

      // Merge in address-level balances (v2). A coin type may have an address
      // balance without any coin objects, so create entries as needed.
      if (addressBalances) {
        Object.entries(addressBalances).forEach(([coinType, value]) => {
          if (value === undefined || value === null) {
            return
          }
          const normalizedCoinType = normalizeStructTag(coinType)
          let existPofolio = balances[normalizedCoinType]
          if (!existPofolio) {
            existPofolio = {
              coinType: normalizedCoinType,
              amount: BigNumber(0),
              addressBalance: BigNumber(0),
              coins: []
            }
            balances[normalizedCoinType] = existPofolio
          }
          existPofolio.addressBalance = BigNumber(value)
        })
      }

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
    return (
      this.balances[coinType] || {
        coinType,
        amount: BigNumber(0),
        addressBalance: BigNumber(0),
        coins: []
      }
    )
  }

  /**
   * Gets the combined total balance for a coin type: the sum of coin objects
   * (`amount`) plus funds held at the address level (`addressBalance`). Use
   * this for sufficiency checks; use `.amount` when you specifically need the
   * coin-object-only sum.
   *
   * @param coinType - The coin type to query
   * @returns BigNumber representing the combined total balance
   */
  combinedBalanceOf(coinType: string) {
    const balance = this.getBalance(coinType)
    return balance.amount.plus(balance.addressBalance ?? 0)
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
  /** Total balance across all coin objects (`Coin<T>`) of this type */
  amount: BigNumber
  /**
   * Funds held directly at the address level (v2 address balances) for this
   * coin type. Not represented by any coin object. Defaults to `0`. The
   * combined spendable total is `amount + addressBalance`.
   */
  addressBalance: BigNumber
  /** Array of individual coin objects */
  coins: CoinStruct[]
}
