import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { describe, expect, it, vi } from 'vitest'
import { getVaultReceipts, ReceiptStruct } from '../../src/protocols/navi/receipt'
import type { Vault } from '../../src/types'

vi.mock('../../src/protocols/navi/vault', () => ({
  getVaultInfo: vi.fn(async () => ({ user_states: { id: '0x3' } })),
  getVaultRewardRules: vi.fn(async () => [])
}))

const vault = { id: '0x1', navi: { package: '0x4' } } as Vault
const row = (result: unknown) => ({ result })
const missing = row({ oneofKind: 'error', error: { code: 5, message: 'not found' } })
function state(shares: bigint) {
  return row({
    oneofKind: 'object',
    object: {
      contents: {
        value: Uint8Array.from([
          ...bcs.Address.serialize('0x9').toBytes(),
          ...bcs.Address.serialize('0x2').toBytes(),
          ...bcs.u64().serialize(shares).toBytes(),
          0,
          0,
          0
        ])
      }
    }
  })
}
function fixture(rows: unknown[], count = rows.length) {
  const batchGetObjects = vi.fn(async ({ requests }: { requests: unknown[] }) => ({
    response: { objects: rows.splice(0, requests.length) }
  }))
  const client = {
    listOwnedObjects: vi.fn(async () => ({
      objects: Array.from({ length: count }, (_, i) => {
        const id = normalizeSuiAddress(`0x${(i + 100).toString(16)}`)
        return {
          objectId: id,
          content: ReceiptStruct.serialize({ id, vaultId: vault.id }).toBytes()
        }
      }),
      hasNextPage: false
    })),
    ledgerService: { batchGetObjects }
  } as unknown as SuiGrpcClient
  return { client, batchGetObjects }
}

describe('NAVI receipt state errors', () => {
  it('keeps funded balances and treats only NOT_FOUND as empty', async () => {
    const { client } = fixture([state(123n), missing])
    const receipts = await getVaultReceipts(vault, '0x5', { client })
    expect(receipts.map(({ shares }) => shares)).toEqual([123n, 0n])
  })

  it.each([7, 13, 14])(
    'rejects per-object RPC status %s even if the message says not found',
    async (code) => {
      const { client } = fixture([
        row({ oneofKind: 'error', error: { code, message: 'not found' } })
      ])
      await expect(getVaultReceipts(vault, '0x5', { client })).rejects.toMatchObject({
        code: 'CHAIN_QUERY_FAILED'
      })
    }
  )

  it.each([
    row({ oneofKind: 'object', object: {} }),
    row({ oneofKind: undefined }),
    row({ oneofKind: 'object', object: { contents: { value: new Uint8Array([1]) } } })
  ])('rejects missing or invalid state data', async (entry) => {
    const { client } = fixture([entry])
    await expect(getVaultReceipts(vault, '0x5', { client })).rejects.toMatchObject({
      code: 'CHAIN_DATA_INVALID'
    })
  })

  it('rejects truncated batches', async () => {
    const { client } = fixture([], 1)
    await expect(getVaultReceipts(vault, '0x5', { client })).rejects.toMatchObject({
      code: 'CHAIN_DATA_INVALID'
    })
  })

  it('wraps transport failures instead of returning balances', async () => {
    const { client, batchGetObjects } = fixture([missing])
    batchGetObjects.mockRejectedValueOnce(new Error('unavailable'))
    await expect(getVaultReceipts(vault, '0x5', { client })).rejects.toMatchObject({
      code: 'CHAIN_QUERY_FAILED'
    })
  })

  it('preserves order across batches of at most 50', async () => {
    const { client, batchGetObjects } = fixture(
      Array.from({ length: 51 }, (_, i) => state(BigInt(i)))
    )
    const receipts = await getVaultReceipts(vault, '0x5', { client })
    expect(receipts.map(({ shares }) => shares)).toEqual(
      Array.from({ length: 51 }, (_, i) => BigInt(i))
    )
    expect(batchGetObjects.mock.calls.map(([request]) => request.requests.length)).toEqual([50, 1])
  })
})
