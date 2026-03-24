import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminConfig } from '../src/config'
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
  fetchMock.mockReset()
})

describe('getAdminConfig', () => {
  it('maps the additive admin payload returned by open-api', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        data: {
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
              coinType:
                '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              decimals: 9,
              symbol: 'SUI',
              poolId: 7,
              pool: '0xpool',
              market: 'ember'
            }
          ],
          version: 2
        }
      })
    })

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
    fetchMock.mockResolvedValue({
      json: async () => ({
        data: {
          package: '0xlegacy',
          storage: '0xstorage',
          incentiveV3: '0xincentive',
          flashloanConfig: '0xflash',
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
          version: 2
        }
      })
    })

    await expect(
      getAdminConfig({
        env: 'dev',
        market: 'main',
        disableCache: true
      })
    ).rejects.toThrow(/lendingAdmin/)
  })

  it('rejects payloads that expose blank admin object ids', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        data: {
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
            oracleFeederCap: '',
            oracleConfig: '0xoracle-config',
            pythStateId: '0xpyth',
            wormholeStateId: '0xwormhole',
            supraOracleHolder: '0xsupra',
            sender: '0xsender',
            gasObject: '0xgas',
            switchboardAggregator: '0xswitchboard',
            feeds: []
          },
          reserveMetadata: [],
          version: 2
        }
      })
    })

    await expect(
      getAdminConfig({
        env: 'prod',
        market: 'main',
        disableCache: true
      })
    ).rejects.toThrow(/oracle\.oracleFeederCap/)
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
