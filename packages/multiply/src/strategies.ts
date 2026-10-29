import type { Strategy } from './types'
import { coinType } from './utils'
export const SUI = coinType('0x2::sui::SUI')
export const VSUI = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
export const HASUI =
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI'
export const strategies = {
  vsuiSui: {
    id: 'vsui-sui',
    market: 'vsui-sui',
    principalCoinType: SUI,
    collateralCoinType: VSUI,
    debtCoinType: SUI
  },
  hasuiSui: {
    id: 'hasui-sui',
    market: 'hasui-sui',
    principalCoinType: SUI,
    collateralCoinType: HASUI,
    debtCoinType: SUI
  }
} satisfies Record<string, Strategy>
export const capName = (id: string) => `navi:multiply:v1:${id}`
