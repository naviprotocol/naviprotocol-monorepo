import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type MarketModule = typeof import('../src/market')

const NEW_MARKET = { id: 99, key: 'x-usdc', name: 'X / USDC Market' }

const marketsResponse = (markets: unknown[], status = 200) =>
  new Response(JSON.stringify({ code: 0, data: { env: 'dev', markets } }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

let market: MarketModule
let fetchMock: ReturnType<typeof vi.fn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  market = await import('../src/market')
})

afterEach(() => {
  vi.unstubAllGlobals()
  warnSpy.mockRestore()
})

describe('market registry: resolution', () => {
  it('resolves a market that only exists in a registered list', () => {
    market.registerMarketConfigs([...Object.values(market.MARKETS), NEW_MARKET], { env: 'dev' })

    expect(market.getMarketConfig(99)).toEqual(NEW_MARKET)
    expect(market.getMarketConfig('x-usdc')).toEqual(NEW_MARKET)
    expect(market.getMarketConfig({ id: 99, key: 'x-usdc', name: 'whatever' })).toEqual(NEW_MARKET)
  })

  it('still throws for a market found nowhere', () => {
    expect(() => market.getMarketConfig(12345)).toThrow('Market not found')
  })

  it('keeps built-in resolution unchanged for existing markets', () => {
    expect(market.getMarketConfig('main')).toEqual({ id: 0, key: 'main', name: 'Main Market' })
    expect(market.getMarketConfig(11)).toEqual(market.MARKETS['eearn-usdc'])
  })
})

describe('market registry: loadMarketConfigs', () => {
  it('fetches /navi/markets for the env and stores the list', async () => {
    fetchMock.mockResolvedValue(
      marketsResponse([{ id: 0, key: 'main', name: 'Main Market' }, NEW_MARKET])
    )

    const configs = await market.loadMarketConfigs({ env: 'dev' })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/navi/markets?env=dev&sdk=')
    expect(configs.map((c) => c.key)).toEqual(['main', 'x-usdc'])
    expect(market.getMarketConfigs({ env: 'dev' })).toEqual(configs)
    expect(market.getMarketConfig(99)).toEqual(NEW_MARKET)
  })

  it('honors the configured open-api base URL', async () => {
    const services = await import('../src/services')
    services.configureNaviSdk({
      services: { naviOpenApi: { baseUrl: 'https://example.test/api/' } }
    })
    fetchMock.mockResolvedValue(marketsResponse([NEW_MARKET]))

    await market.loadMarketConfigs({ env: 'dev' })

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/example\.test\/api\/navi\/markets\?env=dev/
    )
  })

  it.each([
    ['network error', () => Promise.reject(new Error('offline'))],
    ['HTTP 500', () => Promise.resolve(marketsResponse([], 500))],
    ['invalid body', () => Promise.resolve(new Response('{"data":{}}', { status: 200 }))],
    ['only invalid items', () => Promise.resolve(marketsResponse([{ key: 'no-id' }]))]
  ])('falls back to built-in markets without throwing on %s', async (_label, impl) => {
    fetchMock.mockImplementation(impl)

    const configs = await market.loadMarketConfigs({ env: 'dev' })

    expect(configs).toEqual(Object.values(market.MARKETS))
    expect(warnSpy).toHaveBeenCalled()
  })

  it('does not cache a failure: the next call fetches again', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(marketsResponse([NEW_MARKET]))

    await market.loadMarketConfigs({ env: 'dev' })
    const configs = await market.loadMarketConfigs({ env: 'dev' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(configs).toEqual([NEW_MARKET])
  })

  it('caches a success within the cache window', async () => {
    fetchMock.mockResolvedValue(marketsResponse([NEW_MARKET]))

    await market.loadMarketConfigs({ env: 'dev' })
    await market.loadMarketConfigs({ env: 'dev' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('market registry: names and ids', () => {
  it('keeps built-in id and name for known keys; new keys use the open-api name', async () => {
    fetchMock.mockResolvedValue(
      marketsResponse([
        { id: 5, key: 'wbtc-usdc', name: 'lzWBTC/USDC Market' },
        { id: 11, key: 'eearn-usdc', name: 'eEARN/USDC Market' },
        { id: 77, key: 'sui-usdc', name: 'SUI/USDC Market' },
        NEW_MARKET
      ])
    )

    const configs = await market.loadMarketConfigs({ env: 'prod' })

    expect(configs).toEqual([
      market.MARKETS['wbtc-usdc'],
      market.MARKETS['eearn-usdc'],
      market.MARKETS['sui-usdc'],
      NEW_MARKET
    ])
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('sui-usdc'))).toBe(true)
  })
})

describe('market registry: env isolation and replacement', () => {
  it('keeps env lists separate', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('env=dev')
          ? marketsResponse([{ id: 0, key: 'main', name: 'Main Market' }, NEW_MARKET])
          : marketsResponse([{ id: 0, key: 'main', name: 'Main Market' }])
      )
    )

    await market.loadMarketConfigs({ env: 'dev' })
    await market.loadMarketConfigs({ env: 'prod' })

    expect(market.getMarketConfigs({ env: 'dev' }).map((c) => c.key)).toEqual(['main', 'x-usdc'])
    expect(market.getMarketConfigs({ env: 'prod' }).map((c) => c.key)).toEqual(['main'])
  })

  it('replaces the built-in list instead of merging into it', async () => {
    fetchMock.mockResolvedValue(marketsResponse([{ id: 0, key: 'main', name: 'Main Market' }]))

    await market.loadMarketConfigs({ env: 'prod' })

    expect(market.getMarketConfigs({ env: 'prod' })).toEqual([market.MARKETS.main])
  })

  it('returns the built-in list for an env that has nothing loaded', () => {
    expect(market.getMarketConfigs({ env: 'test' })).toEqual(Object.values(market.MARKETS))
    expect(market.getMarketConfigs()).toEqual(Object.values(market.MARKETS))
  })
})

describe('market registry: registerMarketConfigs', () => {
  it('seeds the list but does not stop a later load from fetching', async () => {
    market.registerMarketConfigs([NEW_MARKET], { env: 'dev' })
    expect(market.getMarketConfigs({ env: 'dev' })).toEqual([NEW_MARKET])

    fetchMock.mockResolvedValue(marketsResponse([{ id: 0, key: 'main', name: 'Main Market' }]))
    const configs = await market.loadMarketConfigs({ env: 'dev' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(configs.map((c) => c.key)).toEqual(['main'])
  })

  it('authoritative registration answers loads without HTTP', async () => {
    market.registerMarketConfigs([NEW_MARKET], { env: 'dev', authoritative: true })

    const configs = await market.loadMarketConfigs({ env: 'dev' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(configs).toEqual([NEW_MARKET])
  })

  it('ignores an empty list', () => {
    market.registerMarketConfigs([NEW_MARKET], { env: 'dev' })
    market.registerMarketConfigs([], { env: 'dev' })

    expect(market.getMarketConfigs({ env: 'dev' })).toEqual([NEW_MARKET])
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('market registry: SDK default enumeration', () => {
  it('getLendingState enumerates the env list when no markets are passed', async () => {
    market.registerMarketConfigs([{ id: 0, key: 'main', name: 'Main Market' }, NEW_MARKET], {
      env: 'dev',
      authoritative: true
    })
    fetchMock.mockRejectedValue(new Error('stop after the pools request'))
    const { getLendingState } = await import('../src/account')

    await expect(
      getLendingState('0x0000000000000000000000000000000000000000000000000000000000000001', {
        env: 'dev',
        disableCache: true
      })
    ).rejects.toThrow()

    const poolsUrl = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/navi/pools'))
    expect(poolsUrl).toContain('env=dev')
    expect(decodeURIComponent(poolsUrl!)).toContain('x-usdc')
  })
})
