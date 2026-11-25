import { expect, it, vi } from 'vitest'
import type { MultiplySuiClient } from '../src/types'

// ST-18 (e2e/FAILURE-MATRIX.md): the default client must hand the data source the env it was given, unnormalized, so
// that with env omitted the lending reads get exactly their old options (ST-01). Not observable on the wire: lending
// builds the same URL for an omitted env and for 'prod'.
const seen: { env?: unknown }[] = []
vi.mock('../src/data-source', async (original) => {
  const actual = await original<typeof import('../src/data-source')>()
  return {
    ...actual,
    createNaviDataSource: (options: Parameters<typeof actual.createNaviDataSource>[0]) => {
      seen.push({ ...options })
      return actual.createNaviDataSource(options)
    }
  }
})
const { createMultiplyClient } = await import('../src/client')
const client = { core: {} } as unknown as MultiplySuiClient

it('ST-18: the default client leaves env unset for its data source when env is omitted', () => {
  createMultiplyClient({ client })
  expect(seen.at(-1)).toHaveProperty('env', undefined)
})

it('ST-18: an explicit env reaches the data source as given', () => {
  createMultiplyClient({ client, env: 'dev' })
  expect(seen.at(-1)).toHaveProperty('env', 'dev')
})
