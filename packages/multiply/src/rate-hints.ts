import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { ConversionRateHint, ConversionRequest, MultiplySuiClient } from './types'
import { SUI, VSUI, HASUI } from './strategies'
import { coinType, inspect, sameCoin, uint } from './utils'

const VOLO = {
  package: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
  pool: '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
  metadata: '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60'
}
const HAEDAL = {
  package: '0x19e6ea7f5ced4f090e20da794cc80349a03e638940ddb95155a4e301f5f4967c',
  pool: '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca'
}

/** Mainnet pinned rate getters only. No cash, native fee/minimum or pause admission.
 * No cross-request caching: each hint is read in one PTB (including its epoch),
 * expires after 5 seconds, and is never treated as executable output.
 */
export function createChainRateHintReader(client: MultiplySuiClient) {
  return async (
    pair: Pick<ConversionRequest, 'coinIn' | 'coinOut'>
  ): Promise<ConversionRateHint | undefined> => {
    // Invalid caller coin types remain hard failures, before the optional read.
    const input = coinType(pair.coinIn),
      output = coinType(pair.coinOut)
    const stake = sameCoin(input, SUI)
    const lst = stake ? output : input
    if ((!stake && !sameCoin(output, SUI)) || (!sameCoin(lst, VSUI) && !sameCoin(lst, HASUI)))
      return undefined
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const tx = new Transaction()
      const volo = sameCoin(lst, VSUI)
      if (volo) {
        tx.moveCall({
          target: `${VOLO.package}::stake_pool::refresh`,
          arguments: [tx.object(VOLO.pool), tx.object(VOLO.metadata), tx.object('0x5')]
        })
        tx.moveCall({
          target: `${VOLO.package}::stake_pool::total_sui_supply`,
          arguments: [tx.object(VOLO.pool)]
        })
        tx.moveCall({
          target: `${VOLO.package}::stake_pool::total_lst_supply`,
          arguments: [tx.object(VOLO.metadata)]
        })
      } else {
        // Large integer probe avoids display-rate rounding; this getter has no
        // stake/unstake side effects and imposes no native execution minimum.
        tx.moveCall({
          target: `${HAEDAL.package}::staking::get_stsui_by_sui`,
          arguments: [tx.object(HAEDAL.pool), tx.pure.u64('1000000000000')]
        })
      }
      tx.moveCall({ target: '0x2::tx_context::epoch', arguments: [] })
      const result = await Promise.race([
        inspect(client, tx),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 2000)
        })
      ])
      if (!result || Date.now() >= startedAt + 5000) return undefined
      const value = (i: number) =>
        uint(bcs.u64().parse(result[i].returnValues[0].bcs), false).toString()
      const sui = volo ? value(1) : '1000000000000',
        supply = volo ? value(2) : value(0)
      uint(bcs.u64().parse(result[volo ? 3 : 1].returnValues[0].bcs))
      return {
        input: { coinType: input, amount: stake ? sui : supply },
        output: { coinType: output, amount: stake ? supply : sui },
        expiresAt: startedAt + 5000
      }
    } catch {
      // Optional getter/state unavailable: use the protocol-price seed/solver.
      // Never fabricate a 1:1 exchange rate or gate the aggregator on native cash.
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
}
