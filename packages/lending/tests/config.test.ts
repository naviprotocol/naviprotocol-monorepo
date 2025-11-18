import { describe, it, expect } from 'vitest'
import { getConfig, DEFAULT_CACHE_TIME } from '../src/config'

describe('getConfig', () => {
  it('prod config', async () => {
    const config = await getConfig()
    expect(config).toBeDefined()
    expect(config.package).toEqual(
      '0xee0041239b89564ce870a7dec5ddc5d114367ab94a1137e90aa0633cb76518e0'
    )
  })
  it('dev config', async () => {
    const config = await getConfig({ env: 'dev' })
    expect(config).toBeDefined()
    expect(config.package).toEqual(
      '0x6e9f8bce4bdf026123a156d67d59bd09a7e604679c6a8edda9ca714723162ab7'
    )
  })
})

describe('default config', () => {
  it('DEFAULT_CACHE_TIME', async () => {
    expect(DEFAULT_CACHE_TIME).toBeDefined()
  })
})
