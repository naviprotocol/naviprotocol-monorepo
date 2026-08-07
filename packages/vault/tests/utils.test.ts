import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import {
  decode,
  decodeCommand,
  decodeOne,
  formatUnits,
  isSameAddress,
  normalizeAddress,
  normalizeMoveType,
  ReceiptStruct,
  tryDecodeCoinBalance,
  wadToPercent,
  WAD
} from '../src'

describe('decode', () => {
  it('returns u64 and u256 as bigint', () => {
    // RAY-scaled reward indices routinely exceed Number.MAX_SAFE_INTEGER.
    const big = 12_345_678_901_234_567_890n
    expect(decode.u64(bcs.U64.serialize(big).toBytes())).toBe(big)
    const ray = 10n ** 27n
    expect(decode.u256(bcs.U256.serialize(ray).toBytes())).toBe(ray)
  })

  it('decodes bool, u8 and address', () => {
    expect(decode.bool(bcs.Bool.serialize(true).toBytes())).toBe(true)
    expect(decode.u8(bcs.U8.serialize(1).toBytes())).toBe(1)
    const address = `0x${'1'.repeat(64)}`
    expect(decode.address(bcs.Address.serialize(address).toBytes())).toBe(address)
  })

  it('decodes an ascii::String payload', () => {
    expect(decode.string(bcs.string().serialize('0x2::sui::SUI').toBytes())).toBe('0x2::sui::SUI')
  })

  it('reads the balance out of a returned Coin', () => {
    const bytes = bcs
      .struct('Coin', { id: bcs.Address, balance: bcs.U64 })
      .serialize({ id: `0x${'a'.repeat(64)}`, balance: 42n })
      .toBytes()
    expect(decode.coinBalance(bytes)).toBe(42n)
    expect(tryDecodeCoinBalance(bytes)).toBe(42n)
  })

  it('returns undefined rather than throwing on an undecodable coin', () => {
    expect(tryDecodeCoinBalance(undefined)).toBeUndefined()
    expect(tryDecodeCoinBalance(new Uint8Array([1]))).toBeUndefined()
  })
})

describe('decodeCommand', () => {
  const results = [
    [bcs.U64.serialize(7n).toBytes(), bcs.Address.serialize(`0x${'2'.repeat(64)}`).toBytes()]
  ]

  it('decodes positionally against a schema', () => {
    // The gRPC simulate response carries no Move type strings, so position is all there
    // is — the schema has to come from the contract signature.
    const [count, address] = decodeCommand(results, 0, [decode.u64, decode.address], 'probe')
    expect(count).toBe(7n)
    expect(address).toBe(`0x${'2'.repeat(64)}`)
  })

  it('reads a single-value command', () => {
    expect(decodeOne(results, 0, decode.u64, 'probe')).toBe(7n)
  })

  it('fails loudly when the command is missing', () => {
    expect(() => decodeOne(results, 5, decode.u64, 'probe')).toThrow(/no result/)
  })

  it('fails loudly when the arity does not match the schema', () => {
    // A signature change must not be read as a silently short result.
    expect(() =>
      decodeCommand(results, 0, [decode.u64, decode.address, decode.u64], 'probe')
    ).toThrow(/expected 3/)
  })
})

describe('ReceiptStruct', () => {
  it('round-trips the two-address layout', () => {
    const value = { id: `0x${'1'.repeat(64)}`, vault_address: `0x${'2'.repeat(64)}` }
    const bytes = ReceiptStruct.serialize(value).toBytes()
    expect(bytes).toHaveLength(64)
    expect(ReceiptStruct.parse(bytes).vault_address).toBe(value.vault_address)
  })
})

describe('normalizeMoveType', () => {
  it('restores the 0x prefix that type_name strips', () => {
    // get_rule_info returns the reward coin type via type_name::into_string, which
    // renders the address bare. Passing it straight back as a type argument is rejected
    // by the gRPC transport with a protobuf FIELD_INVALID, not a Move abort — so it does
    // not read as a type problem at the call site.
    const bare = '549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
    expect(normalizeMoveType(bare)).toBe(`0x${bare}`)
  })

  it('is idempotent on an already-prefixed type', () => {
    const prefixed = '0x2::sui::SUI'
    expect(normalizeMoveType(prefixed)).toBe(normalizeMoveType(normalizeMoveType(prefixed)))
  })

  it('canonicalizes short addresses', () => {
    expect(normalizeMoveType('0x2::sui::SUI')).toBe(normalizeMoveType('2::sui::SUI'))
  })
})

describe('address helpers', () => {
  it('pads and lowercases', () => {
    expect(normalizeAddress('0x2')).toBe(`0x${'0'.repeat(63)}2`)
    expect(normalizeAddress('0xAB')).toBe(`0x${'0'.repeat(62)}ab`)
  })

  it('compares across paddings', () => {
    expect(isSameAddress('0x2', `0x${'0'.repeat(63)}2`)).toBe(true)
    expect(isSameAddress('0x2', '0x3')).toBe(false)
  })
})

describe('display formatting', () => {
  it('converts WAD rates to percent', () => {
    expect(wadToPercent(WAD)).toBe(100)
    expect(wadToPercent(WAD / 20n)).toBe(5)
    expect(wadToPercent(20_000_000_000_000_000n)).toBe(2)
  })

  it('formats native-decimal amounts', () => {
    expect(formatUnits(1_000_000n, 6)).toBe('1.000000')
    expect(formatUnits(1n, 9)).toBe('0.000000001')
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.500000')
    expect(formatUnits(42n, 0)).toBe('42')
  })
})
