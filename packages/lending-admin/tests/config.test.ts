import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CACHE_TIME, getAdminConfig } from '../src/config'
import {
  getReserveByAssetId,
  getReserveByCoinType,
  resolveDecimalsByCoinType,
  resolveLendingAdminCap,
  resolvePoolAddressByAssetId,
  resolvePoolIdByCoinType
} from '../src/resolvers'

const fetchMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  vi.useRealTimers()
  fetchMock.mockReset()
})

function buildAdminConfigPayload() {
  return {
    package: '0xlegacy',
    storage: '0xstorage',
    incentiveV3: '0xincentive',
    flashloanConfig: '0xflash',
    lendingAdmin: {
      package: '0xcurrent',
      storage: '0xstorage',
      incentiveV3: '0xincentive',
      flashloanConfig: '0xflash',
      poolAdminCap: '0xpool-cap',
      storageAdminCap: '0xstorage-cap',
      ownerCap: '0xowner-cap',
      incentiveOwnerCap: '0xincentive-owner'
    },
    oracle: {
      packageId: '0xoracle-pkg',
      priceOracle: '0xprice',
      oracleAdminCap: '0xoracle-admin',
      oracleFeederCap: '0xoracle-feeder',
      oracleConfig: '0xoracle-config',
      pythStateId: '0xpyth',
      wormholeStateId: '0xwormhole',
      supraOracleHolder: '0xsupra',
      sender: '0xsender',
      gasObject: '0xgas',
      switchboardAggregator: '0xswitchboard',
      feeds: []
    },
    reserveMetadata: [
      {
        assetId: 0,
        coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
        decimals: 9,
        symbol: 'SUI',
        poolId: 7,
        pool: '0xpool',
        market: 'main'
      }
    ],
    version: 2
  }
}

function mockConfigResponse(data = buildAdminConfigPayload()) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data })
  }
}

describe('getAdminConfig', () => {
  it('maps the additive admin payload returned by open-api', async () => {
    const payload = buildAdminConfigPayload()
    payload.reserveMetadata[0].market = 'ember'
    fetchMock.mockResolvedValue(mockConfigResponse(payload))

    const config = await getAdminConfig({
      env: 'dev',
      market: 'ember',
      disableCache: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('market=ember')
    expect(config.lending.package).toBe('0xcurrent')
    expect(config.oracle.oracleFeederCap).toBe('0xoracle-feeder')
    expect(config.reserveMetadata[0]?.market).toBe('ember')
    expect(config.market.key).toBe('ember')
  })

  it('rejects payloads that do not expose admin fields', async () => {
    const payload = buildAdminConfigPayload() as any
    delete payload.lendingAdmin
    fetchMock.mockResolvedValue(mockConfigResponse(payload))

    await expect(
      getAdminConfig({
        env: 'dev',
        market: 'main',
        disableCache: true
      })
    ).rejects.toThrow(/lendingAdmin/)
  })

  it('rejects payloads that expose blank admin object ids', async () => {
    const payload = buildAdminConfigPayload()
    payload.oracle.oracleFeederCap = ''
    payload.reserveMetadata = []
    fetchMock.mockResolvedValue(mockConfigResponse(payload))

    await expect(
      getAdminConfig({
        env: 'prod',
        market: 'main',
        disableCache: true
      })
    ).rejects.toThrow(/oracle\.oracleFeederCap/)
  })

  it('uses DEFAULT_CACHE_TIME when cacheTime is omitted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T00:00:00Z'))

    const firstPayload = buildAdminConfigPayload()
    const secondPayload = buildAdminConfigPayload()
    secondPayload.version = 3

    fetchMock.mockResolvedValueOnce(mockConfigResponse(firstPayload))
    fetchMock.mockResolvedValueOnce(mockConfigResponse(secondPayload))

    const first = await getAdminConfig({ env: 'test', market: 'ember' })
    const second = await getAdminConfig({ env: 'test', market: 'ember' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.version).toBe(2)
    expect(second.version).toBe(2)

    vi.setSystemTime(new Date('2026-03-25T00:05:00.001Z'))
    const third = await getAdminConfig({ env: 'test', market: 'ember' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(DEFAULT_CACHE_TIME).toBe(1000 * 60 * 5)
    expect(third.version).toBe(3)
  })

  it('throws a descriptive error for non-2xx HTTP responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'boom' })
    })

    await expect(
      getAdminConfig({
        env: 'prod',
        market: 'main',
        disableCache: true
      })
    ).rejects.toThrow(/HTTP 500 Internal Server Error/)
  })
})

describe('reserve and cap resolvers', () => {
  const config = {
    lending: {
      package: '0xcurrent',
      storage: '0xstorage',
      incentiveV3: '0xincentive',
      flashloanConfig: '0xflash',
      poolAdminCap: '0xpool-cap',
      storageAdminCap: '0xstorage-cap',
      ownerCap: '0xowner-cap',
      incentiveOwnerCap: '0xincentive-owner'
    },
    oracle: {
      packageId: '0xoracle-pkg',
      priceOracle: '0xprice',
      oracleAdminCap: '0xoracle-admin',
      oracleFeederCap: '0xoracle-feeder',
      oracleConfig: '0xoracle-config',
      pythStateId: '0xpyth',
      wormholeStateId: '0xwormhole',
      supraOracleHolder: '0xsupra',
      sender: '0xsender',
      gasObject: '0xgas',
      switchboardAggregator: '0xswitchboard',
      feeds: []
    },
    reserveMetadata: [
      {
        assetId: 0,
        coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
        decimals: 9,
        symbol: 'SUI',
        poolId: 7,
        pool: '0xpool-sui',
        market: 'main'
      },
      {
        assetId: 1,
        coinType: '0x0eedc3857f39f5e44b5786ebcd790317902ffca9960f44fcea5b7589cfc7a784::usdc::USDC',
        decimals: 6,
        symbol: 'USDC',
        poolId: 8,
        pool: '0xpool-usdc',
        market: 'main'
      }
    ],
    market: {
      id: 0,
      key: 'main',
      name: 'Main Market'
    },
    version: 2
  }

  it('resolves reserves by asset id and coin type', () => {
    expect(getReserveByAssetId(config, 0).symbol).toBe('SUI')
    expect(getReserveByCoinType(config, '0x2::sui::SUI').pool).toBe('0xpool-sui')
  })

  it('resolves pool ids, pool addresses, decimals, and admin caps', () => {
    expect(resolvePoolAddressByAssetId(config, 1)).toBe('0xpool-usdc')
    expect(resolvePoolIdByCoinType(config, '0x2::sui::SUI')).toBe(7)
    expect(resolveDecimalsByCoinType(config, '0x2::sui::SUI')).toBe(9)
    expect(resolveLendingAdminCap(config, 'storageAdminCap')).toBe('0xstorage-cap')
  })
})
