import './fetch'
import { describe, it, expect } from 'vitest'
import { getConfig, DEFAULT_CACHE_TIME } from '../src/config'

describe('getConfig', () => {
  it('prod config', async () => {
    const config = await getConfig()
    console.log(JSON.stringify(config, null, 2))
    expect(config).toBeDefined()
    expect(config.package).toEqual(
      '0x81c408448d0d57b3e371ea94de1d40bf852784d3e225de1e74acab3e8395c18f'
    )
  })
  it('dev config', async () => {
    const config = await getConfig({ env: 'dev' })
    expect(config).toBeDefined()
    expect(config.package).toEqual(
      '0xacc64a324fc6f68b47fefd484419dedc4d620630665ead67f393c90d11b387b9'
    )
  })
})

describe('default config', () => {
  it('DEFAULT_CACHE_TIME', async () => {
    expect(DEFAULT_CACHE_TIME).toBeDefined()
  })
})
