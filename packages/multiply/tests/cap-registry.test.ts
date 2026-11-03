import { describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { createNaviDataSource } from '../src/data-source'
import { strategies } from '../src/strategies'
import {
  ACCOUNT_CAP_TYPE,
  MAINNET_CAP_REGISTRY,
  registryKeyString,
  registerCreatedCapPTB
} from '../src/cap-registry'
import { address } from '../src/utils'
import type { MultiplySuiClient, Strategy } from '../src/types'

vi.mock('@naviprotocol/lending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@naviprotocol/lending')>()),
  getConfig: vi.fn(async () => ({
    emode: { contract: { registryPackage: '0x88', registryObject: '0x89' } }
  }))
}))

const wallet = address('0xaa'),
  cap1 = address('0x10'),
  cap2 = address('0x20')
const schema = bcs.struct('AccountCap', { id: bcs.Address, owner: bcs.Address })
const returns = (ids: string[], versions: string[], caps: string[]) => ({
  returnValues: [
    { bcs: bcs.vector(bcs.u64()).serialize(ids).toBytes() },
    { bcs: bcs.vector(bcs.u64()).serialize(versions).toBytes() },
    { bcs: bcs.vector(bcs.Address).serialize(caps).toBytes() }
  ]
})
function fixture(
  ids = ['1'],
  versions = ['1'],
  caps = [cap1],
  configured = Object.values(strategies) as Strategy[]
) {
  const results = [returns(ids, versions, caps), returns([], [], [])]
  const objects = caps.map((id) => ({
    objectId: id,
    type: ACCOUNT_CAP_TYPE,
    version: '1',
    digest: 'fixture',
    owner: { $kind: 'AddressOwner', AddressOwner: wallet },
    content: schema.serialize({ id, owner: id }).toBytes()
  }))
  const core = {
    simulateTransaction: vi.fn(async () => ({
      Transaction: { status: { success: true } },
      commandResults: results
    })),
    getObjects: vi.fn(async ({ objectIds }: { objectIds: string[] }) => ({
      objects: objects.filter((o) => objectIds.includes(o.objectId)).reverse()
    })),
    listOwnedObjects: vi.fn(() => {
      throw new Error('Legacy discovery forbidden')
    }),
    listDynamicFields: vi.fn(() => {
      throw new Error('Metadata discovery forbidden')
    })
  }
  const source = createNaviDataSource({
    client: { core } as unknown as MultiplySuiClient,
    strategies: configured
  })
  return { source, core, objects, results }
}

it('resolves numeric keys, matches unordered object responses and never reads metadata', async () => {
  const f = fixture(['1', '2'], ['1', '1'], [cap1, cap2])
  const caps = await f.source.listAccountCaps(wallet)
  expect(caps.map((c) => [c.id, c.strategyId])).toEqual([
    [cap1, 'vsui-sui'],
    [cap2, 'hasui-sui']
  ])
  expect(caps[0]).not.toHaveProperty('name')
  expect(caps[0].registryKey).toEqual(strategies.vsuiSui.registryKey)
  expect(f.core.listOwnedObjects).not.toHaveBeenCalled()
  expect(f.core.listDynamicFields).not.toHaveBeenCalled()
  const tx = f.core.simulateTransaction.mock.calls[0][0].transaction as Transaction
  expect(tx.getData().commands.map((c) => c.$kind === 'MoveCall' && c.MoveCall.function)).toEqual([
    'find_user_mul_account_caps',
    'find_user_emode_account_caps'
  ])
})

it('returns empty solely from the Registry without scanning unregistered Caps', async () => {
  const f = fixture([], [], [])
  expect(await f.source.listAccountCaps(wallet)).toEqual([])
  expect(f.core.getObjects).not.toHaveBeenCalled()
  expect(f.core.listOwnedObjects).not.toHaveBeenCalled()
})

it('batches all objects beyond one batch without truncating', async () => {
  const definitions = Array.from({ length: 51 }, (_, i) => ({
    ...strategies.vsuiSui,
    id: `pair-${i}`,
    registryKey: { strategyNumericId: String(i + 1), strategyVersion: '1' }
  }))
  const f = fixture(
    definitions.map((s) => s.registryKey.strategyNumericId),
    definitions.map(() => '1'),
    definitions.map((_, i) => address(`0x${(i + 100).toString(16)}`)),
    definitions
  )
  expect(await f.source.listAccountCaps(wallet)).toHaveLength(51)
  expect(f.core.getObjects).toHaveBeenCalledTimes(2)
})

it.each([
  ['99', '1'],
  ['1', '2'],
  ['0', '0']
])('rejects unknown complete key %s:%s', async (id, version) => {
  await expect(fixture([id], [version]).source.listAccountCaps(wallet)).rejects.toMatchObject({
    code: 'UNSUPPORTED_REGISTRY_STRATEGY'
  })
})

it('rejects missing rows, invalid BCS and failed simulations instead of returning empty', async () => {
  await expect(fixture(['1'], [], [cap1]).source.listAccountCaps(wallet)).rejects.toMatchObject({
    code: 'READ_FAILED'
  })
  const f = fixture()
  f.results[0].returnValues[0].bcs = new Uint8Array([255])
  await expect(f.source.listAccountCaps(wallet)).rejects.toMatchObject({ code: 'READ_FAILED' })
  f.core.simulateTransaction.mockRejectedValueOnce(new Error('network timeout'))
  await expect(f.source.listAccountCaps(wallet)).rejects.toMatchObject({ code: 'READ_FAILED' })
})

it.each(['owner', 'type', 'content', 'zero', 'emode'])(
  'rejects invalid registered Cap: %s',
  async (reason) => {
    const f = reason === 'zero' ? fixture(['1'], ['1'], [address('0x0')]) : fixture()
    if (reason === 'owner') f.objects[0].owner.AddressOwner = address('0xbb')
    if (reason === 'type') f.objects[0].type = '0x2::coin::Coin<0x2::sui::SUI>'
    if (reason === 'content') f.objects[0].content = new Uint8Array([])
    if (reason === 'emode') f.results[1] = returns(['1'], ['1'], [cap1])
    await expect(f.source.listAccountCaps(wallet)).rejects.toMatchObject({
      code: 'INVALID_ACCOUNT_CAP'
    })
  }
)

it('rejects one Cap or account registered under multiple strategies', async () => {
  await expect(
    fixture(['1', '2'], ['1', '1'], [cap1, cap1]).source.listAccountCaps(wallet)
  ).rejects.toMatchObject({ code: 'DUPLICATE_ACCOUNT_CAP' })
  const f = fixture(['1', '2'], ['1', '1'], [cap1, cap2])
  f.objects[1].content = schema.serialize({ id: cap2, owner: cap1 }).toBytes()
  await expect(f.source.listAccountCaps(wallet)).rejects.toMatchObject({
    code: 'DUPLICATE_ACCOUNT_CAP'
  })
})

it('rejects incomplete object responses', async () => {
  const f = fixture()
  f.core.getObjects.mockResolvedValueOnce({ objects: [] })
  await expect(f.source.listAccountCaps(wallet)).rejects.toMatchObject({ code: 'READ_FAILED' })
})

describe('contract key constraints', () => {
  it.each([
    ['0', '1'],
    ['1', '0'],
    ['1', '100000'],
    ['18446744073709551615', '1'],
    ['01', '1']
  ])('rejects unsupported key %s:%s before building', (id, version) => {
    expect(() => registryKeyString({ strategyNumericId: id, strategyVersion: version })).toThrow()
  })
  it('uses bigint beyond Number precision and rejects colliding configurations', () => {
    expect(
      registryKeyString({ strategyNumericId: '184467440737095', strategyVersion: '51615' })
    ).toBe('184467440737095:51615')
    expect(() =>
      createNaviDataSource({
        strategies: [
          strategies.vsuiSui,
          { ...strategies.hasuiSui, registryKey: strategies.vsuiSui.registryKey }
        ]
      })
    ).toThrow('duplicate numeric')
  })
})

it('registers the new Cap object address as a PTB result with the fixed key', () => {
  const tx = new Transaction()
  const cap = tx.moveCall({ target: '0x99::lending::create_account' })
  registerCreatedCapPTB(tx, cap, strategies.vsuiSui.registryKey, MAINNET_CAP_REGISTRY)
  const calls = tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => c.MoveCall)
  expect(calls.map((c) => c.function)).toEqual([
    'create_account',
    'id_address',
    'register_mul_for_account_cap'
  ])
  expect(calls[1].typeArguments).toEqual([ACCOUNT_CAP_TYPE])
  expect(calls[2].arguments[1]).toMatchObject({ Result: 1 })
})
