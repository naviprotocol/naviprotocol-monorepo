import type { TransactionObjectArgument } from '@mysten/sui/transactions'
import type { IntegerString } from '../types'

export interface DepositPTBOptions {
  /**
   * Coin type to fund the deposit with. Must be one of the vault's
   * `assets.deposits`; defaults to `assets.base.coinType`.
   *
   * NAVI Lending accepts only the principal coin — its `deposit` is generic over the
   * vault's own `CoinType` — and rejects anything else with `UNSUPPORTED_DEPOSIT_ASSET`.
   * Volo accepts a configured set of non-principal coins and swaps them into the
   * principal first.
   */
  coinType?: string
  coin?: TransactionObjectArgument
  useGasCoin?: boolean
  /**
   * Position to credit. Both protocols' `deposit` takes an `Option<Receipt>`.
   *
   * Omit to resolve one automatically: top up the owner's receipt when they hold one,
   * mint a new one when they hold none. Passing a value skips that lookup.
   */
  receipt?: string | TransactionObjectArgument
}

export interface WithdrawPTBOptions {
  /**
   * Volo only: cancel the owner's pending deposit request before withdrawing. Required
   * when the vault still holds one for them — the contract refuses to withdraw otherwise.
   *
   * Needs {@link pendingDepositRequestId} alongside it.
   */
  cancelPendingDeposit?: boolean
  /**
   * Request id of the pending deposit to cancel. Comes from
   * `user.getPendingRequests()`.
   */
  pendingDepositRequestId?: IntegerString
  /**
   * Position to withdraw from.
   *
   * Omit only when the owner holds exactly one receipt on the vault. Holding several is
   * ambiguous — each is an independent position, and a withdrawal drains the one it is
   * pointed at, so guessing would take funds from a position the caller did not choose.
   */
  receipt?: string | TransactionObjectArgument
}
