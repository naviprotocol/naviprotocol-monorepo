import { Transaction } from '@mysten/sui/transactions'
import { AggregatorConfig } from '../config'

/**
 * FlowX AMM（v2 恒定乘积，Cetus 叫 FLOWX；与 FlowX CLMM `Dex.FLOWX` 是两套合约）：直接调协议包 v1 的
 * router::swap_exact_input_direct<In, Out>(Container, Coin<In>): Coin<Out>
 * 类型参数按交易方向（输入、输出）传，合约内部按 type_name 排序找 pair；整枚输入币进池子，没有 min_out、没有找零
 * （滑点由整笔交易末尾的检查兜底）。
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
