import { beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import {
  ReserveDataInfo,
  UserStateInfo,
  type EMode,
  type Market,
  type Pool
} from '@naviprotocol/lending'
import { createNaviDataSource } from '../src/data-source'
import { resolveEMode } from '../src/emode'
import { BN, RAY, address } from '../src/utils'
import type { LendingConfig, MultiplySuiClient, Strategy } from '../src/types'
const mock = vi.hoisted(() => ({
  market: vi.fn(),
  config: vi.fn(),
  flash: vi.fn(),
  oracle: vi.fn()
}))
vi.mock('@naviprotocol/lending', async (original) => ({
  ...(await original<typeof import('@naviprotocol/lending')>()),
  getMarket: mock.market,
  getConfig: mock.config,
  getAllFlashLoanAssets: mock.flash,
  updateOraclePricesPTB: mock.oracle,
  getPools: () => {
    throw new Error('Duplicate pool read')
  }
}))
const strategy: Strategy = {
  id: 'main-vsui-sui',
  market: 'main',
  emodeId: 0,
  registryKey: { strategyNumericId: '4', strategyVersion: '2' },
  principalCoinType: '0x2::sui::SUI',
  collateralCoinType: '0x5::cert::CERT',
  debtCoinType: '0x2::sui::SUI'
}
const group: EMode = {
  emodeId: 0,
  marketId: 0,
  uniqueId: 'main-0',
  isActive: true,
  assets: [
    { assetId: 5, isCollateral: true, isDebt: false, ltv: 0.9, lt: 0.93, bonus: 0.02 },
    { assetId: 0, isCollateral: false, isDebt: true, ltv: 0, lt: 0, bonus: 0 }
  ]
}
const config = {
  version: 2,
  package: '0x20',
  storage: '0x21',
  priceOracle: '0x22',
  uiGetter: '0x23',
  limter: '0x24',
  flashloanConfig: '0x25',
  oracle: {
    feeds: [{ coinType: strategy.collateralCoinType }, { coinType: strategy.debtCoinType }]
  }
} as LendingConfig
const pools = [5, 0].map((id, i) => ({
  id,
  oracleId: id,
  market: 'main',
  suiCoinType: i ? strategy.debtCoinType : strategy.collateralCoinType,
  token: { decimals: 9 }
})) as Pool[]
const market = (mode: EMode | null) =>
  ({ config: { key: 'main', id: 0 }, pools, getEMode: vi.fn(() => mode) }) as unknown as Market
const result = (...values: Uint8Array[]) => ({ returnValues: values.map((bcs) => ({ bcs })) })
const ray = (value: string) => new BN(value).times(RAY.toString()).toFixed(0)
const reserve = (id: number) =>
  Object.assign(
    Object.fromEntries(
      [
        'supply_cap',
        'borrow_cap',
        'supply_rate',
        'borrow_rate',
        'total_supply',
        'total_borrow',
        'last_update_at',
        'treasury_factor',
        'treasury_balance',
        'base_rate',
        'multiplier',
        'jump_rate_multiplier',
        'reserve_factor',
        'optimal_utilization',
        'liquidation_ratio',
        'liquidation_bonus'
      ].map((key) => [key, '0'])
    ),
    {
      id,
      oracle_id: id,
      coin_type: id === 5 ? strategy.collateralCoinType : strategy.debtCoinType,
      supply_index: RAY.toString(),
      borrow_index: RAY.toString(),
      ltv: ray('.7'),
      liquidation_threshold: ray('.75')
    }
  )
beforeEach(() => {
  vi.resetAllMocks()
  mock.config.mockResolvedValue(config)
  mock.market.mockResolvedValue(market(structuredClone(group)))
  mock.flash.mockResolvedValue([
    { coinType: strategy.debtCoinType, poolId: address('0x26'), min: '0', max: '9999999' }
  ])
})
it.each([0, undefined])(
  'reads one market with services/cache options and effective risk (mode %s)',
  async (emodeId) => {
    const inspect = vi.fn(async () => ({
      Transaction: { status: { success: true } },
      commandResults: [
        result(bcs.u256().serialize('1100000000000000000').toBytes()),
        result(bcs.u256().serialize('1000000000000000000').toBytes()),
        result(
          bcs
            .vector(ReserveDataInfo)
            .serialize([reserve(5), reserve(0)] as never)
            .toBytes()
        ),
        result(bcs.u64().serialize(10500).toBytes()),
        result(
          ...[0, 0, 0].map(() => bcs.u64().serialize(0).toBytes()),
          bcs.Address.serialize(address('0x26')).toBytes(),
          ...[1, 2, 9999999, 0].map((x) => bcs.u64().serialize(x).toBytes())
        )
      ]
    }))
    const services = { openApi: { baseUrl: 'https://fixture.invalid' } }
    const source = createNaviDataSource({
      client: { core: { simulateTransaction: inspect } } as unknown as MultiplySuiClient,
      services
    })
    const snapshot = await source.readMarket({ ...strategy, emodeId })
    expect(mock.market).toHaveBeenCalledExactlyOnceWith('main', { services, disableCache: true })
    expect(snapshot).toMatchObject({
      ltv: emodeId === 0 ? '0.9' : '0.7',
      liquidationThreshold: emodeId === 0 ? '0.93' : '0.75',
      borrowWeight: '1.05',
      collateralPrice: '1.1',
      debtPrice: '1',
      flash: { feeBps: '3' }
    })
    expect(snapshot.emode).toEqual(emodeId === 0 ? { id: 0, active: true } : undefined)
  }
)
it.each([
  'wrong market',
  'wrong id',
  'reverse',
  'duplicate',
  'ray instead of decimal',
  'lt below ltv'
])('rejects group: %s', async (variant) => {
  const mode = structuredClone(group)
  if (variant === 'wrong market') mode.marketId = 1
  if (variant === 'wrong id') mode.emodeId = 1
  if (variant === 'reverse') {
    mode.assets[0].isCollateral = false
    mode.assets[1].isDebt = false
  }
  if (variant === 'duplicate') mode.assets.push(mode.assets[0])
  if (variant === 'ray instead of decimal') mode.assets[0].ltv = 9e26
  if (variant === 'lt below ltv') mode.assets[0].lt = 0.8
  await expect(
    resolveEMode({} as MultiplySuiClient, strategy, config, market(mode), pools[0], pools[1])
  ).rejects.toThrow()
})
it('reads balances without querying account mode and preserves precision and asset isolation', async () => {
  const inspect = vi.fn(async (_: unknown) => ({
    Transaction: { status: { success: true } },
    commandResults: [
      result(),
      result(
        bcs
          .vector(ReserveDataInfo)
          .serialize([reserve(5), reserve(0)] as never)
          .toBytes()
      ),
      result(
        bcs
          .vector(UserStateInfo)
          .serialize([
            { asset_id: 5, supply_balance: '999', borrow_balance: '0' },
            { asset_id: 0, supply_balance: '0', borrow_balance: '1001' }
          ])
          .toBytes()
      )
    ]
  }))
  const source = createNaviDataSource({
    client: { core: { simulateTransaction: inspect } } as unknown as MultiplySuiClient
  })
  const supplied = {
    config,
    collateral: { ...pools[0], token: { decimals: 6 } },
    debt: { ...pools[1], token: { decimals: 6 } }
  }
  const cap = {
    id: address('0xa'),
    accountOwner: address('0xb'),
    strategyId: strategy.id,
    registryKey: strategy.registryKey
  }
  expect(await source.readPosition(cap, strategy, supplied as never)).toEqual({
    collateralAmount: '0',
    debtAmount: '2',
    protocolCollateralAmount: '999',
    protocolDebtAmount: '1001'
  })
  const tx = (
    inspect.mock.calls[0][0] as { transaction: import('@mysten/sui/transactions').Transaction }
  ).transaction
  expect(tx.getData().commands.map((c) => c.$kind === 'MoveCall' && c.MoveCall.function)).toEqual([
    'update_state_of_user',
    'get_reserve_data',
    'get_user_state'
  ])
  await expect(
    source.readPosition(cap, strategy, {
      ...supplied,
      collateral: { ...supplied.collateral, id: 6 }
    } as never)
  ).rejects.toMatchObject({ code: 'POSITION_UNSUPPORTED' })
})
it.each([false, true])(
  'reads only targeted configuration when filtered (active: %s)',
  async (active) => {
    const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() })
    const state = bcs.struct('Emode', {
      emodes_pair: table,
      user_emode_id: table,
      next_emode_id: bcs.u64()
    })
    const asset = bcs.struct('EmodeAsset', {
      assetId: bcs.u8(),
      isCollateral: bcs.bool(),
      isDebt: bcs.bool(),
      ltv: bcs.u256(),
      lt: bcs.u256(),
      liquidation_bonus: bcs.u256()
    })
    const pair = bcs.struct('EmodeConfig', { assetA: asset, assetB: asset, isActive: bcs.bool() })
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        dynamicField: {
          value: {
            bcs: state
              .serialize({
                emodes_pair: { id: address('0x30'), size: '1' },
                user_emode_id: { id: address('0x31'), size: '0' },
                next_emode_id: '1'
              })
              .toBytes()
          }
        }
      })
      .mockResolvedValueOnce({
        dynamicField: {
          value: {
            bcs: pair
              .serialize({
                assetA: {
                  ...group.assets[0],
                  ltv: ray('.9'),
                  lt: ray('.93'),
                  liquidation_bonus: ray('.02')
                },
                assetB: { ...group.assets[1], ltv: '0', lt: '0', liquidation_bonus: '0' },
                isActive: active
              })
              .toBytes()
          }
        }
      })
    const pending = resolveEMode(
      {
        core: {
          getDynamicField: read,
          listDynamicFields: vi
            .fn()
            .mockResolvedValue({
              dynamicFields: [
                {
                  name: {
                    type: '0x999::storage::EMODE_KEY',
                    bcs: bcs.bool().serialize(false).toBytes()
                  }
                }
              ],
              hasNextPage: false
            })
        }
      } as unknown as MultiplySuiClient,
      strategy,
      config,
      market(null),
      pools[0],
      pools[1]
    )
    if (active) await expect(pending).rejects.toThrow('missing from market catalogue')
    else
      await expect(pending).resolves.toMatchObject({
        emodeId: 0,
        isActive: false,
        assets: [expect.objectContaining({ ltv: 0.9, lt: 0.93 }), expect.anything()]
      })
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0][0].name.type).toBe('0x999::storage::EMODE_KEY')
    expect(read.mock.calls[1][0]).toMatchObject({
      parentId: address('0x30'),
      name: { type: 'u64' }
    })
    expect(read.mock.calls.some(([req]) => req.parentId === address('0x31'))).toBe(false)
  }
)
it('fails closed when the configured group is unavailable', async () => {
  const client = {
    core: { listDynamicFields: vi.fn().mockRejectedValue(new Error('unavailable')) }
  }
  await expect(
    resolveEMode(
      client as unknown as MultiplySuiClient,
      strategy,
      config,
      market(null),
      pools[0],
      pools[1]
    )
  ).rejects.toThrow('unavailable')
})
