import { describe, it, expect } from 'vitest'
import { getConfig, DEFAULT_CACHE_TIME } from '../src/config'

const SUI_ID_PATTERN = /^0x[0-9a-f]{64}$/

describe('getConfig', () => {
  it('prod config', async () => {
    const config = await getConfig()
    expect(config).toBeDefined()
    expect(config.package).toMatch(SUI_ID_PATTERN)
  })
  it('dev config', async () => {
    const config = await getConfig({ env: 'dev' })
    expect(config).toBeDefined()
    expect(config.package).toMatch(SUI_ID_PATTERN)
  })

  it('prod and dev configs expose different package ids', async () => {
    const [prodConfig, devConfig] = await Promise.all([getConfig(), getConfig({ env: 'dev' })])

    expect(prodConfig.package).not.toEqual(devConfig.package)
  })
})

describe('default config', () => {
  it('DEFAULT_CACHE_TIME', async () => {
    expect(DEFAULT_CACHE_TIME).toBeDefined()
  })
})
