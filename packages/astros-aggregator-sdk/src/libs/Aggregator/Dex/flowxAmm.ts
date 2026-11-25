import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * FlowX AMM (v2 constant product, called FLOWX by Cetus; a different contract from FlowX CLMM `Dex.FLOWX`).
 * Calls router::swap_exact_input_direct<In, Out>(Container, Coin<In>): Coin<Out> on protocol package v1.
 * Type arguments are passed in trade order (input, output); the contract sorts them by type_name to find
 * the pair. The whole input coin goes in, with no min_out and no change (the end-of-transaction slippage
 * check covers it).
 */
export async function makeFlowxAmmPTB(
  txb: Transaction,
  pathTempCoin: any,
  coinTypeIn: string,
  coinTypeOut: string
) {
  const [out] = txb.moveCall({
    target: `${AggregatorConfig.flowxAmmPackageId}::router::swap_exact_input_direct`,
    typeArguments: [coinTypeIn, coinTypeOut],
    arguments: [txb.object(AggregatorConfig.flowxAmmContainer), pathTempCoin]
  })
  return out
}
