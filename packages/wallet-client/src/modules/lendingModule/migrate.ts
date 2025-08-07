import { Transaction } from '@mysten/sui/transactions'
import {
  AssetIdentifier,
  getFlashLoanAsset,
  flashloanPTB,
  depositCoinPTB,
  withdrawCoinPTB,
  repayFlashLoanPTB,
  repayCoinPTB,
  borrowCoinPTB,
  mergeCoinsPTB
} from '@naviprotocol/lending'
import { buildSwapPTBFromQuote, getQuote } from '@naviprotocol/astros-aggregator-sdk'
import type { LendingModule } from '.'
import { fromRate } from './utils'
import BigNumber from 'bignumber.js'
import { normalizeStructTag } from '@mysten/sui/utils'

export async function migrateBetweenSupplyPTB(
  this: LendingModule,
  tx: Transaction,
  from: AssetIdentifier,
  to: AssetIdentifier,
  options?: Partial<{
    amount?: number
    slippage?: number
  }>
) {
  if (!this.walletClient) {
    throw new Error('Wallet client not found')
  }
  const fromPool = await this.getPool(from)
  const toPool = await this.getPool(to)
  const lendingState = await this.getLendingState()
  const fromPoolLending = lendingState.find((lending) => lending.pool.id === fromPool.id)
  const address = this.walletClient.address

  if (!fromPoolLending || fromPoolLending.supplyBalance === '0') {
    throw new Error('No supply balance')
  }

  if (options?.amount && options.amount < Number(fromPoolLending.supplyBalance)) {
    throw new Error('Amount is less than supply balance')
  }

  const toPoolFlashloanAsset = await getFlashLoanAsset(toPool, {
    env: this.config.env
  })

  if (!toPoolFlashloanAsset?.flashloanFee) {
    throw new Error(`${fromPool.token.symbol} pool not support flashloan`)
  }

  const slippage = options?.slippage ?? 0.005

  const formAmount = options?.amount ?? Number(fromPoolLending.supplyBalance)

  const quote = await this.walletClient.swap.getQuote(
    fromPool.suiCoinType,
    toPool.suiCoinType,
    formAmount
  )

  const shouldSwapAmount = Number(quote.amount_out)

  if (shouldSwapAmount <= 0) {
    throw new Error('The amount of swapAmountOut must be greater than 0.')
  }

  const minAmountOut = Math.floor(shouldSwapAmount * (1 - slippage))

  const borrowAmountInMin = Math.floor(minAmountOut / (1 + toPoolFlashloanAsset.flashloanFee))

  if (borrowAmountInMin <= 0) {
    throw new Error('The calculated borrow amount must be positive.')
  }

  const [flashloanBalance, receipt] = await flashloanPTB(tx, toPool, borrowAmountInMin)

  const [flashCoin] = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [flashloanBalance],
    typeArguments: [toPool.suiCoinType]
  })

  await depositCoinPTB(tx, toPool, flashCoin, {
    amount: borrowAmountInMin
  })

  const withdrawnFromCoin = await withdrawCoinPTB(tx, fromPool, formAmount)

  const swappedToCoin = await buildSwapPTBFromQuote(
    address,
    tx,
    minAmountOut,
    withdrawnFromCoin,
    quote
  )

  const repayBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    arguments: [swappedToCoin],
    typeArguments: [toPool.suiCoinType]
  })

  const [leftBalance] = await repayFlashLoanPTB(tx, toPool, receipt, repayBalance)

  const [extraCoin] = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [leftBalance],
    typeArguments: [toPool.suiCoinType]
  })

  await depositCoinPTB(tx, toPool, extraCoin)

  return tx
}

export async function migrateBetweenBorrowPTB(
  this: LendingModule,
  tx: Transaction,
  from: AssetIdentifier,
  to: AssetIdentifier,
  options?: Partial<{
    amount?: number
    slippage?: number
  }>
) {
  if (!this.walletClient) {
    throw new Error('Wallet client not found')
  }
  const address = this.walletClient.address
  const fromPool = await this.getPool(from)
  const toPool = await this.getPool(to)
  const lendingState = await this.getLendingState()
  const fromPoolLending = lendingState.find((lending) => lending.pool.id === fromPool.id)

  if (!fromPoolLending || fromPoolLending.borrowBalance === '0') {
    throw new Error('No borrow balance')
  }

  if (options?.amount && options.amount < Number(fromPoolLending.borrowBalance)) {
    throw new Error('Amount is less than borrow balance')
  }

  let formAmount = options?.amount ?? Number(fromPoolLending.borrowBalance)

  if (Number(fromPoolLending.borrowBalance) === formAmount) {
    const borrowRate = parseFloat(fromRate(fromPool.currentBorrowRate, 8)) / 100
    formAmount = Math.ceil(
      new BigNumber(formAmount)
        .multipliedBy((borrowRate * (60 * 3)) / (365 * 24 * 3600))
        .plus(new BigNumber(1).shiftedBy(-fromPool.token.decimals))
        .plus(formAmount)
        .toNumber()
    )
  }

  const fromPoolFlashloanAsset = await getFlashLoanAsset(fromPool, {
    env: this.config.env
  })

  if (!fromPoolFlashloanAsset) {
    throw new Error(`${fromPool.token.symbol} pool not support flashloan`)
  }

  if (!this.walletClient) {
    throw new Error('Wallet client not found')
  }

  const slippage = options?.slippage ?? 0.005

  const floshloanRepayAmount = Math.ceil(formAmount * (1 + fromPoolFlashloanAsset.flashloanFee))
  const minSwapAmount = floshloanRepayAmount

  const fromQuote = await this.walletClient.swap.getQuote(
    fromPool.suiCoinType,
    toPool.suiCoinType,
    minSwapAmount
  )

  let rate = 1 + slippage

  let shouldBorrowAmount = Math.ceil(Number(fromQuote.amount_out) * rate)

  let toQuote = await this.walletClient.swap.getQuote(
    toPool.suiCoinType,
    fromPool.suiCoinType,
    shouldBorrowAmount
  )

  while (Number(toQuote.amount_out) < minSwapAmount) {
    rate = rate * Math.max(minSwapAmount / Number(toQuote.amount_out), 1.001)
    shouldBorrowAmount = Math.ceil(Number(fromQuote.amount_out) * rate)
    toQuote = await this.walletClient.swap.getQuote(
      toPool.suiCoinType,
      fromPool.suiCoinType,
      shouldBorrowAmount
    )
  }

  const [flashloanBalance, receipt] = await flashloanPTB(tx, fromPool, formAmount)

  const [flashCoin]: any = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [flashloanBalance],
    typeArguments: [fromPool.suiCoinType]
  })

  await repayCoinPTB(tx, fromPool, flashCoin, {
    amount: formAmount
  })

  const borrowCoin = await borrowCoinPTB(tx, toPool, shouldBorrowAmount)

  const swappedFromCoin = await buildSwapPTBFromQuote(
    address,
    tx,
    floshloanRepayAmount,
    borrowCoin,
    toQuote
  )

  const repayBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    arguments: [swappedFromCoin],
    typeArguments: [fromPool.suiCoinType]
  })

  const [leftBalance] = await repayFlashLoanPTB(tx, fromPool, receipt, repayBalance)

  const [extraCoin] = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [leftBalance],
    typeArguments: [fromPool.suiCoinType]
  })
  tx.transferObjects([extraCoin], address)

  return tx
}

export async function migrateBalanceToSupplyPTB(
  this: LendingModule,
  tx: Transaction,
  coinType: string,
  to: AssetIdentifier,
  options?: Partial<{
    amount?: number
    slippage?: number
  }>
) {
  if (!this.walletClient) {
    throw new Error('Wallet client not found')
  }
  const address = this.walletClient.address
  const toPool = await this.getPool(to)
  const balance = this.walletClient.balance.portfolio.getBalance(coinType)

  if (balance.amount.eq(0)) {
    throw new Error(`No balance of ${coinType}`)
  }

  if (options?.amount && balance.amount.lt(options.amount)) {
    throw new Error('Amount is less than balance')
  }

  const formAmount = options?.amount ?? balance.amount.toNumber()

  const slippage = options?.slippage ?? 0.005

  let depositCoin = await mergeCoinsPTB(tx, balance.coins, {
    balance: formAmount,
    useGasCoin: true
  })

  if (normalizeStructTag(coinType) !== normalizeStructTag(toPool.suiCoinType)) {
    const quote = await this.walletClient.swap.getQuote(coinType, toPool.suiCoinType, formAmount)
    depositCoin = await this.walletClient.swap.buildSwapPTBFromQuote(
      tx,
      quote,
      depositCoin,
      slippage
    )
  }

  await depositCoinPTB(tx, toPool, depositCoin)

  return tx
}
