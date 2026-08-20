import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { buildSwapPTBFromQuote, getQuote } from '@naviprotocol/astros-aggregator-sdk'
import type { Quote } from '@naviprotocol/astros-aggregator-sdk'
import { VaultSdkError } from '../../errors'
import type { VoloVault } from '../../vaults'

/**
 * Slippage tolerance on the swap leg, matching the Volo backend's hardcoded 1%.
 *
 * This bounds "what the swap actually returns" against "what it was quoted", and is not
 * exposed as an option: it protects the swap, not the vault deposit, and the two are
 * different concerns.
 */
const MIN_OUT_RATIO = 0.99

/**
 * The aggregator computes price impact and flags it on the response, but the published
 * `Quote` type does not declare the field.
 */
type QuoteWithImpact = Quote & { high_price_impact?: boolean }

/**
 * Swaps a non-principal coin into the vault's principal and returns the resulting coin
 * plus a handle to its value.
 *
 * The value has to be read on chain with `coin::value`: how much the swap yields is only
 * known at execution time, so the deposit's `amount` argument cannot be a literal.
 */
export async function swapToPrincipalPTB(
  tx: Transaction,
  vault: VoloVault,
  owner: string,
  inputCoinType: string,
  inputCoin: TransactionObjectArgument,
  inputAmount: bigint
): Promise<{ coin: TransactionObjectArgument; amount: TransactionObjectArgument }> {
  const principalCoinType = vault.assets.base.coinType

  let quote: QuoteWithImpact
  try {
    quote = (await getQuote(inputCoinType, principalCoinType, inputAmount)) as QuoteWithImpact
  } catch (error) {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      `No swap route from ${inputCoinType} to ${principalCoinType}.`,
      { cause: error }
    )
  }

  // A quote can be technically valid and still terrible: a large trade through thin
  // liquidity moves the price against the user, and the swap would execute anyway. The
  // min-out below only bounds actual-versus-quoted, so it cannot catch this.
  if (quote.high_price_impact === true) {
    throw new VaultSdkError(
      'UNSUPPORTED_DEPOSIT_ASSET',
      `Swapping ${inputAmount} ${inputCoinType} into ${principalCoinType} moves the price ` +
        `too far. Deposit the principal coin directly, or split the amount.`
    )
  }

  const minAmountOut = Number(quote.amount_out) * MIN_OUT_RATIO

  // Appending the swap makes its own network call (the aggregator checks positive
  // slippage), so this can fail independently of the quote. Wrap it: the raw axios error
  // would otherwise be the one thing in this package that is not a VaultSdkError.
  let swapped: TransactionObjectArgument
  try {
    swapped = (await buildSwapPTBFromQuote(
      owner,
      tx,
      minAmountOut,
      inputCoin as never,
      quote,
      0,
      // The aggregator logs its route selection by default. An SDK has no business
      // writing to a consumer's console.
      false
    )) as unknown as TransactionObjectArgument
  } catch (error) {
    throw new VaultSdkError(
      'CHAIN_QUERY_FAILED',
      `Building the ${inputCoinType} to ${principalCoinType} swap failed: ` +
        `${(error as Error).message}`,
      { cause: error }
    )
  }

  const amount = tx.moveCall({
    target: '0x2::coin::value',
    typeArguments: [principalCoinType],
    arguments: [swapped]
  }) as unknown as TransactionObjectArgument

  return { coin: swapped, amount }
}
