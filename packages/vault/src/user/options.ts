import type { TransactionObjectArgument } from '@mysten/sui/transactions'

export interface DepositPTBOptions {
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
   * Position to withdraw from.
   *
   * Omit only when the owner holds exactly one receipt on the vault. Holding several is
   * ambiguous — each is an independent position, and a withdrawal drains the one it is
   * pointed at, so guessing would take funds from a position the caller did not choose.
   */
  receipt?: string | TransactionObjectArgument
}
