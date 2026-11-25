import { normalizeSuiAddress } from '@mysten/sui/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vault } from '../../src/types'

const MARKET = normalizeSuiAddress('0x9001')

vi.mock('@naviprotocol/lending', () => ({
  DEFAULT_CACHE_TIME: 1000,
  getConfig: vi.fn(async () => ({})),
  getPools: vi.fn(async () => [{ market: 'main', contract: { pool: MARKET } }])
}))
// Stub the vault-object read (`getVaultInfo` is the only cached call used here).
vi.mock('../../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils')>()
  return {
    ...actual,
    withSingleton: (fn: unknown) => fn,
    withCache: () => async () => ({ default_market: MARKET })
  }
})

import * as lending from '@naviprotocol/lending'
import { getVaultDefaultPool } from '../../src/protocols/navi/vault'
import { getLendingEnv, getMarketConfig } from '../../src/protocols/navi/utils'

const vault = { id: '0x1', navi: { package: '0x4' } } as Vault
const withEnv = (lendingEnv: 'prod' | 'dev') =>
  ({ ...vault, navi: { package: '0x4', lendingEnv } }) as Vault

beforeEach(() => vi.clearAllMocks())

describe('lendingEnv', () => {
  it('defaults to prod', () => {
    expect(getLendingEnv(vault)).toBe('prod')
    expect(getLendingEnv(withEnv('dev'))).toBe('dev')
  })

  it('reaches getPools through getVaultDefaultPool', async () => {
    await getVaultDefaultPool(withEnv('dev'))
    expect(lending.getPools).toHaveBeenCalledWith(expect.objectContaining({ env: 'dev' }))
    await getVaultDefaultPool(vault)
    expect(lending.getPools).toHaveBeenLastCalledWith(expect.objectContaining({ env: 'prod' }))
  })

  it('reaches getConfig through getMarketConfig', async () => {
    await getMarketConfig('main', { env: 'dev' })
    expect(lending.getConfig).toHaveBeenCalledWith(expect.objectContaining({ env: 'dev' }))
    await getMarketConfig('main')
    expect(lending.getConfig).toHaveBeenLastCalledWith(expect.objectContaining({ env: 'prod' }))
  })
})
