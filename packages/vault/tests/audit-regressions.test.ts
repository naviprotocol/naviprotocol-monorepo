import { describe, expect, it } from 'vitest'
import {
  assertOperable,
  findReceipts,
  MAINNET_VAULT_CONFIG,
  NaviVaultError,
  parseVaultError,
  ReceiptStruct
} from '../src'
import { usdcHighYieldLayout } from './fixtures'

const VAULT_ID = '0x54359eb5d0e4364bd26989899fdb472f5594d1885e1f0d816ef4a066cab2ae4c'
const OWNER = `0x${'a'.repeat(64)}`

describe('pagination cannot loop forever', () => {
  /** A transport that claims another page but never advances the cursor. */
  function stuckClient(cursor: string | null) {
    let calls = 0
    const client = {
      core: {
        listOwnedObjects: async () => {
          calls += 1
          if (calls > 20) throw new Error('infinite pagination')
          return {
            objects: [
              {
                objectId: `0x${'1'.repeat(64)}`,
                content: ReceiptStruct.serialize({
                  id: `0x${'1'.repeat(64)}`,
                  vault_address: VAULT_ID
                }).toBytes()
              }
            ],
            cursor,
            hasNextPage: true
          }
        }
      }
    }
    return { client: client as never, calls: () => calls }
  }

  it('stops when the transport reports another page but returns no cursor', async () => {
    const { client, calls } = stuckClient(null)
    const receipts = await findReceipts(OWNER, 'USDC', { client })
    expect(receipts).toHaveLength(1)
    expect(calls()).toBe(1)
  })

  it('stops when the transport keeps returning the cursor it was given', async () => {
    // First page has no cursor to compare against, so it is fetched; the second returns
    // the same cursor and must terminate rather than re-request it.
    const { client, calls } = stuckClient('same-cursor')
    const receipts = await findReceipts(OWNER, 'USDC', { client })
    expect(calls()).toBeLessThanOrEqual(2)
    expect(receipts.length).toBeGreaterThan(0)
  })
})

describe('abort classification is consistent between SDK and chain', () => {
  it('classifies E_MARKET_INVALID the same way whichever raised it', () => {
    // market.ts pre-empts 10010 before building; the chain raises it too. A caller
    // branching on `kind` must not see two different answers for one condition.
    const fromChain = parseVaultError('MoveAbort(MoveLocation { ... }, 10010)')
    expect(fromChain?.kind).toBe('outage')
  })

  it.each([
    [10011, 'outage'],
    [10036, 'outage'],
    [1400, 'outage'],
    [10010, 'outage'],
    [10021, 'user'],
    [1506, 'liquidity']
  ])('code %i is %s', (code, kind) => {
    expect(parseVaultError(`MoveAbort(MoveLocation { x }, ${code})`)?.kind).toBe(kind)
  })
})

describe('assertOperable', () => {
  const layout = usdcHighYieldLayout()

  it('passes a live vault at the expected version', () => {
    expect(() => assertOperable(layout, 'Deposit', 2)).not.toThrow()
  })

  it('rejects a paused vault', () => {
    expect(() => assertOperable({ ...layout, paused: true }, 'Deposit', 2)).toThrow(/paused/)
  })

  it('rejects a vault whose contract version has drifted', () => {
    // Every entrypoint aborts 10036 in this state; catching it here saves the gas.
    try {
      assertOperable({ ...layout, version: 3n }, 'Deposit', 2)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NaviVaultError)
      expect((error as NaviVaultError).code).toBe(10036)
      expect((error as NaviVaultError).kind).toBe('outage')
    }
  })

  it('skips the version check when configuration declares none', () => {
    expect(() => assertOperable({ ...layout, version: 99n }, 'Deposit', undefined)).not.toThrow()
  })

  it('is wired to the bundled snapshot', () => {
    expect(MAINNET_VAULT_CONFIG.package.expectedVaultVersion).toBe(2)
  })
})
