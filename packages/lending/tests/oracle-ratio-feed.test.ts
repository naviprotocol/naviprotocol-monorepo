import { describe, it, expect, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeSuiAddress, toHex } from '@mysten/sui/utils'
import type { OraclePriceFeed } from '../src/types'

const ORACLE_PACKAGE = '0xe64be9213b8f66845502634d4b1ed2b4683a5e1aebd5afec6b2eb560dffc93b3'

vi.mock('../src/config', () => ({
  DEFAULT_CACHE_TIME: 300000,
  getConfig: async () => ({
    oracle: {
      packageId: ORACLE_PACKAGE,
      updateFunction: 'update_single_price_v3',
      oracleConfig: '0x31ae70e991f359bca7fb78a8b1da7c8c88cca8d23fc6d18754c37e54ed36dcc5',
      priceOracle: '0xdbe2405aa5f5703f288102c3eb865bb8f82468822b570db03782564be7b2d2a1',
      supraOracleHolder: '0xaa0315f0748c1f24ddb2b45f7939cff40f7a8104af5ccbc4a1d32f870c0b4105',
      switchboardAggregator: '0x1fa7566f40f93cdbafd5a029a231e06664219444debb59beec2fe3f19ca08b7e',
      feeds: []
    }
  })
}))

import { filterPriceFeeds, isRatioPriceFeed, updateOraclePricesPTB } from '../src/oracle'

// stage_v2 (open-api env=dev) entries: SUI, vSUI's own feed, and vSUI's ratio feed (Crypto.VSUI/SUI.RR,
// on-chain oracle id 200) listed under vSUI's oracle id 5.
const SUI = {
  oracleId: 0,
  feedId: '0x256e5cacfd9c20af7273e93b4e48bdaf4125376fb25800daeb232ec010f3a57a',
  pythPriceInfoObject: '0x89b2add829cb6fcd017153fff428bc9faec4d06d643ecfc435af5b55a9e987f0'
} as OraclePriceFeed
const VSUI = {
  oracleId: 5,
  feedId: '0x28a15e35ad71c48da8e76bd1e324e79959a149a5ec5f226886592038f3569772',
  pythPriceInfoObject: '0x89b2add829cb6fcd017153fff428bc9faec4d06d643ecfc435af5b55a9e987f0'
} as OraclePriceFeed
const VSUI_RR = {
  oracleId: 5,
  ratioOracleId: 200,
  feedId: '0xadbe2241a66b24ff86ccec9b88b19d4f3ce4e5a8ebe0633a4f9f4d72b5937dcf',
  pythPriceInfoObject: '0x7d9d8613953d8d1ad522bfad786921dbfe2b43a9d414ade2fbb6a7688b5552c6'
} as OraclePriceFeed
const FEEDS = [SUI, VSUI, VSUI_RR]

describe('composite ratio feeds', () => {
  it('isRatioPriceFeed tells a ratio feed from an own feed', () => {
    expect(FEEDS.map(isRatioPriceFeed)).toEqual([false, false, true])
  })

  it('filterPriceFeeds keeps the ratio feed with its asset (pools)', () => {
    const feeds = filterPriceFeeds(FEEDS, { pools: [{ oracleId: 5 }] as any })
    expect(feeds.map((feed) => feed.feedId)).toEqual([VSUI.feedId, VSUI_RR.feedId])
  })

  it('filterPriceFeeds keeps the ratio feed with its asset (lending state)', () => {
    const feeds = filterPriceFeeds(FEEDS, { lendingState: [{ pool: { oracleId: 5 } }] as any })
    expect(feeds.map((feed) => feed.feedId)).toEqual([VSUI.feedId, VSUI_RR.feedId])
  })

  it('filterPriceFeeds leaves the ratio feed out when the asset is not involved', () => {
    const feeds = filterPriceFeeds(FEEDS, { pools: [{ oracleId: 0 }] as any })
    expect(feeds.map((feed) => feed.feedId)).toEqual([SUI.feedId])
  })

  it('updateOraclePricesPTB pushes the asset feed and its ratio feed', async () => {
    const tx = new Transaction()
    await updateOraclePricesPTB(tx, [VSUI, VSUI_RR], { updatePythPriceFeeds: false })
    const data = tx.getData()
    const calls = data.commands.map((command: any) => command.MoveCall)
    expect(calls.map((call: any) => `${call.package}::${call.module}::${call.function}`)).toEqual([
      `${ORACLE_PACKAGE}::oracle_pro::update_single_price_v3`,
      `${ORACLE_PACKAGE}::oracle_pro::update_single_price_v3`
    ])
    const feedArgs = calls.map((call: any) => {
      const input: any = data.inputs[call.arguments[6].Input]
      return normalizeSuiAddress('0x' + toHex(fromBase64(input.Pure.bytes)))
    })
    expect(feedArgs).toEqual([VSUI.feedId, VSUI_RR.feedId])
    const pythArgs = calls.map((call: any) => {
      const input: any = data.inputs[call.arguments[4].Input]
      return input.UnresolvedObject?.objectId ?? input.Object?.ImmOrOwnedObject?.objectId
    })
    expect(pythArgs).toEqual([VSUI.pythPriceInfoObject, VSUI_RR.pythPriceInfoObject])
  })
})
