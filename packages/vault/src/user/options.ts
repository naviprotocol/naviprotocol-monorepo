import type { TransactionObjectArgument } from '@mysten/sui/transactions'

export interface DepositPTBOptions {
  coinType?: string
  coin?: TransactionObjectArgument
  useGasCoin?: boolean
}

export interface WithdrawPTBOptions {
  cancelPendingDeposit?: boolean
}
