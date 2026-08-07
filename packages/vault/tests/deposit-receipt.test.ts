import { describe, expect, it } from 'vitest'
import { NaviVaultError, NEW_POSITION, resolveDepositReceipt } from '../src'
import { ReceiptStruct } from '../src'

const SENDER = `0x${'a'.repeat(64)}`
const VAULT = 'SUI_PRIME'
const VAULT_ID = '0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7'

/** Stub client returning the given receipts as owned objects. */
function clientWith(receiptIds: string[]) {
  return {
    core: {
      listOwnedObjects: async () => ({
        objects: receiptIds.map((objectId) => ({
          objectId,
          content: ReceiptStruct.serialize({ id: objectId, vault_address: VAULT_ID }).toBytes()
        })),
        cursor: null,
        hasNextPage: false
      })
    }
  } as never
}

const receipt = (n: string) => `0x${n.repeat(64)}`

/** Fails if touched — proves an explicit choice skips the lookup entirely. */
const explodingClient = {
  core: {
    listOwnedObjects: async () => {
      throw new Error('lookup should not happen')
    }
  }
} as never

describe('resolveDepositReceipt', () => {
  it('mints a new position when the sender holds none', async () => {
    const resolved = await resolveDepositReceipt(
      { vault: VAULT, sender: SENDER },
      { client: clientWith([]) }
    )
    expect(resolved).toBeUndefined()
  })

  it('tops up the existing position when the sender holds exactly one', async () => {
    // Without this, every deposit opens a fresh position and abandons the previous one.
    const resolved = await resolveDepositReceipt(
      { vault: VAULT, sender: SENDER },
      { client: clientWith([receipt('1')]) }
    )
    expect(resolved).toBe(receipt('1'))
  })

  it('refuses to guess when the sender holds several', async () => {
    try {
      await resolveDepositReceipt(
        { vault: VAULT, sender: SENDER },
        { client: clientWith([receipt('1'), receipt('2')]) }
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NaviVaultError)
      // The message has to be actionable: list them so the caller can paste one back.
      expect((error as NaviVaultError).message).toContain(receipt('1'))
      expect((error as NaviVaultError).message).toContain(receipt('2'))
      // The message must name the way out, not just the problem.
      expect((error as NaviVaultError).message).toContain("position: 'new'")
      expect((error as NaviVaultError).kind).toBe('user')
    }
  })

  it('honours an explicit position without looking anything up', async () => {
    const resolved = await resolveDepositReceipt(
      { vault: VAULT, sender: SENDER, position: receipt('9') },
      { client: explodingClient }
    )
    expect(resolved).toBe(receipt('9'))
  })

  it("honours position: 'new' without looking anything up", async () => {
    const resolved = await resolveDepositReceipt(
      { vault: VAULT, sender: SENDER, position: NEW_POSITION },
      { client: explodingClient }
    )
    expect(resolved).toBeUndefined()
  })

  it('ignores receipts belonging to a different vault', async () => {
    // Receipt is not generic, so one type covers every vault; only vault_address separates them.
    const foreign = {
      core: {
        listOwnedObjects: async () => ({
          objects: [
            {
              objectId: receipt('7'),
              content: ReceiptStruct.serialize({
                id: receipt('7'),
                vault_address: `0x${'f'.repeat(64)}`
              }).toBytes()
            }
          ],
          cursor: null,
          hasNextPage: false
        })
      }
    }
    const resolved = await resolveDepositReceipt(
      { vault: VAULT, sender: SENDER },
      { client: foreign as never }
    )
    expect(resolved).toBeUndefined()
  })
})
