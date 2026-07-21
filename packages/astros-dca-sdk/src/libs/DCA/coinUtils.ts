/**
 * DCA Coin Utilities
 * Helper functions for coin selection and merging
 */

import { Transaction, TransactionResult } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import type { NaviDcaCoinClient, NaviDcaPaginatedCoins } from './client'

const SUI_COIN_TYPE = normalizeStructTag('0x2::sui::SUI')

/**
 * Get coins for a specific address and coin type
 * Handles pagination automatically to fetch all coins
 */
export async function getCoins(
  client: NaviDcaCoinClient,
  address: string,
  coinType: string = '0x2::sui::SUI'
): Promise<NaviDcaPaginatedCoins> {
  let cursor: string | null | undefined = null
  const allCoinData: any[] = []

  // Fetch all coins using pagination
  do {
    const core = client.core as
      | {
          listCoins?(options: any): Promise<any>
        }
      | undefined
    const response: any =
      typeof core?.listCoins === 'function'
        ? await core.listCoins({
            owner: address,
            coinType,
            cursor,
            limit: 100
          })
        : typeof client.getCoins === 'function'
          ? await client.getCoins({
              owner: address,
              coinType,
              cursor,
              limit: 100 // Maximum limit per page
            })
          : (() => {
              throw new Error(
                'DCA coin selection requires core.listCoins or an explicit legacy getCoins client'
              )
            })()
    const pageData = response.objects ?? response.data ?? []

    // Break if no more data
    if (!pageData.length) {
      break
    }

    // Collect coin data and continue with next page
    allCoinData.push(...pageData)
    cursor = response.cursor ?? response.nextCursor
  } while (cursor)

  // Return all coins in the same format as PaginatedCoins
  return {
    data: allCoinData,
    nextCursor: null,
    hasNextPage: false
  }
}

function getCoinObjectId(coin: { coinObjectId?: string; objectId?: string }) {
  const objectId = coin.coinObjectId ?? coin.objectId
  if (!objectId) {
    throw new Error('Coin object is missing coinObjectId/objectId')
  }
  return objectId
}

/**
 * Read a coin's combined balance via the v2 Core `getBalance`.
 *
 * On Sui, a fungible balance is `coinBalance` (sum of `Coin<T>` objects) plus
 * `addressBalance` (funds held directly at the address, arriving via
 * `send_funds()`). `listCoins`/`getCoins` only see coin objects, so sufficiency
 * checks based on them under-count once address balances are in play. This reads
 * the authoritative combined total so callers can source the shortfall from the
 * address balance.
 *
 * Returns `null` when the injected client exposes no `core.getBalance`
 * (legacy path) — callers then fall back to coin-object-only behavior.
 */
async function getCombinedBalance(
  client: NaviDcaCoinClient,
  owner: string,
  coinType: string
): Promise<{ total: bigint; addressBalance: bigint } | null> {
  const core = client.core as { getBalance?(options: any): Promise<any> } | undefined
  if (typeof core?.getBalance !== 'function') {
    return null
  }
  let response: any
  try {
    response = await core.getBalance({ owner, coinType })
  } catch {
    // Transient getBalance failure: fall back to coin-object-only selection
    // instead of aborting the build (matches wallet-client's address-balance
    // fetch, which catches and falls back).
    return null
  }
  // Core getBalance may return `{ balance: {...} }` or a flat object. Only take a
  // nested object as the balance; if `balance` is a scalar (the numeric total on
  // the flat shape) fall back to the response itself, so addressBalance is read
  // from the right place instead of collapsing to 0. Also accept the
  // `fundsInAddressBalance` alias (matching lending's normalizeAddressBalance).
  const nested = response?.balance
  const balance =
    nested && typeof nested === 'object'
      ? nested
      : response && typeof response === 'object'
        ? response
        : null
  if (!balance) {
    return null
  }
  const total = BigInt(balance.balance ?? balance.totalBalance ?? 0)
  const addressBalance = BigInt(balance.addressBalance ?? balance.fundsInAddressBalance ?? 0)
  return { total, addressBalance }
}

/**
 * Get and prepare coin for DCA order creation
 * Automatically fetches coins, merges them, and splits the required amount
 *
 * @param client - SuiClient instance
 * @param tx - Transaction to build
 * @param address - User wallet address
 * @param coinType - Coin type to use
 * @param amount - Amount needed (in atomic units)
 * @returns Transaction result containing the split coin
 */
export async function getCoinForDca(
  client: NaviDcaCoinClient,
  tx: Transaction,
  address: string,
  coinType: string,
  amount: string | number | bigint
): Promise<TransactionResult> {
  if (normalizeStructTag(coinType) === SUI_COIN_TYPE) {
    // Handle SUI gas coin - split from gas. Normalize so every SUI form (short
    // `0x2::sui::SUI` or the fully-expanded address) takes the gas path and
    // never redeems from address balance.
    return tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
  } else {
    // Handle other token types
    const coinInfo = await getCoins(client, address, coinType)
    const objects = coinInfo.data ?? []
    const objectsBalance = objects.reduce((sum, coin) => sum + BigInt(coin.balance ?? 0), 0n)
    const need = BigInt(amount)

    // Address balances (v2): part of the balance can live at the address level
    // (not as Coin<T> objects). `getCoins` only sees coin objects, so validate
    // against the combined balance and, when the objects fall short, withdraw
    // the remainder from the address balance via `0x2::coin::redeem_funds`.
    const combined = await getCombinedBalance(client, address, coinType)
    const addressBalance = combined ? combined.addressBalance : 0n
    // Combined spendable = owned coin objects + address balance. Sizing both the
    // sufficiency check and the shortfall from the same `objectsBalance` keeps the
    // redeemed amount from ever exceeding the available address balance.
    const total = objectsBalance + addressBalance

    if (total < need) {
      throw new Error(`Insufficient balance: need ${need}, have ${total}`)
    }

    // Base coin + merge list: all owned Coin<T> objects (largest first), plus a
    // coin redeemed from the address balance to cover any shortfall.
    const sorted = [...objects].sort((a: any, b: any) =>
      Number(BigInt(b.balance ?? 0) - BigInt(a.balance ?? 0))
    )
    let baseCoin: any
    const mergeList: any[] = []
    for (const coin of sorted) {
      const obj = tx.object(getCoinObjectId(coin))
      if (baseCoin === undefined) {
        baseCoin = obj
      } else {
        mergeList.push(obj)
      }
    }

    const shortfall = objectsBalance >= need ? 0n : need - objectsBalance
    let baseIsRedeemed = false
    if (shortfall > 0n) {
      const withdrawnCoin = tx.moveCall({
        target: '0x2::coin::redeem_funds',
        typeArguments: [coinType],
        arguments: [tx.withdrawal({ amount: shortfall, type: coinType })]
      })
      if (baseCoin === undefined) {
        baseCoin = withdrawnCoin
        baseIsRedeemed = true
      } else {
        mergeList.push(withdrawnCoin)
      }
    }

    if (baseCoin === undefined) {
      throw new Error(`No ${coinType} coins found for address ${address}`)
    }
    if (mergeList.length > 0) {
      tx.mergeCoins(baseCoin, mergeList)
    }

    // Pure address-balance case: the base is the redeemed coin (no owned coin
    // objects), and shortfall === need, so it already holds exactly `amount`.
    // Return it directly — splitting the full amount would leave a zero-balance
    // redeemed Coin result unused, and Coin has no `drop` ability, so the PTB
    // would fail at dry-run/execution. (Mixed object + address paths split from
    // an owned object base, whose leftover stays in place and is fine.)
    if (baseIsRedeemed) {
      return baseCoin
    }

    // Split the required amount
    return tx.splitCoins(baseCoin, [tx.pure.u64(amount)])
  }
}
