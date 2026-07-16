import { describe, expect, it } from 'vitest'
import {
  describeShape,
  diffShape,
  diffSnapshots,
  nodeKind,
  sizeBucket
} from '../../scripts/lib/read-snapshot-shape.mjs'

function emptyOut() {
  return { regressions: [], warnings: [] }
}

describe('sizeBucket', () => {
  it('buckets array lengths into coarse magnitudes', () => {
    expect(sizeBucket(0)).toBe('0')
    expect(sizeBucket(1)).toBe('1')
    expect(sizeBucket(2)).toBe('2-10')
    expect(sizeBucket(10)).toBe('2-10')
    expect(sizeBucket(11)).toBe('10+')
    expect(sizeBucket(9999)).toBe('10+')
  })
})

describe('describeShape', () => {
  it('erases scalar values, keeping only the type name', () => {
    expect(describeShape(42)).toEqual({ type: 'number' })
    expect(describeShape('0xdigest')).toEqual({ type: 'string' })
    expect(describeShape(true)).toEqual({ type: 'boolean' })
    expect(describeShape(10n)).toEqual({ type: 'bigint' })
  })

  it('records sorted key paths for objects without values', () => {
    const shape = describeShape({ b: 1, a: 'x', nested: { z: true } })
    expect(shape.type).toBe('object')
    expect(shape.keys).toEqual(['a', 'b', 'nested'])
    expect(shape.fields.a).toEqual({ type: 'string' })
    expect(shape.fields.nested).toEqual({
      type: 'object',
      keys: ['z'],
      fields: { z: { type: 'boolean' } }
    })
  })

  it('samples the first element and buckets array size', () => {
    const shape = describeShape([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(shape.type).toBe('array')
    expect(shape.size).toBe('2-10')
    expect(shape.element).toEqual({
      type: 'object',
      keys: ['id'],
      fields: { id: { type: 'number' } }
    })
  })

  it('produces identical shapes when only values (not structure) change', () => {
    const a = describeShape({ price: 1.23, balance: '100', ts: 1712345678 })
    const b = describeShape({ price: 9.99, balance: '5', ts: 1799999999 })
    expect(a).toEqual(b)
  })

  it('marks empty arrays with a null element and truncates deep nesting', () => {
    expect(describeShape([])).toEqual({ type: 'array', size: '0', element: null })
    expect(describeShape(null)).toEqual({ type: 'null' })
    expect(describeShape(undefined)).toEqual({ type: 'undefined' })
  })
})

describe('nodeKind', () => {
  it('classifies container vs scalar vs nullish', () => {
    expect(nodeKind({ type: 'array' })).toBe('array')
    expect(nodeKind({ type: 'object' })).toBe('object')
    expect(nodeKind({ type: 'number' })).toBe('scalar')
    expect(nodeKind({ type: 'null' })).toBe('nullish')
    expect(nodeKind(null)).toBe('nullish')
  })
})

describe('diffShape', () => {
  it('flags a removed field as a regression', () => {
    const base = describeShape({ a: 1, b: 2 })
    const cur = describeShape({ a: 1 })
    const out = emptyOut()
    diffShape(base, cur, 'm', out)
    expect(out.regressions).toEqual([{ type: 'field-missing', path: 'm.b' }])
    expect(out.warnings).toEqual([])
  })

  it('flags an added field as a non-blocking warning', () => {
    const base = describeShape({ a: 1 })
    const cur = describeShape({ a: 1, c: 3 })
    const out = emptyOut()
    diffShape(base, cur, 'm', out)
    expect(out.regressions).toEqual([])
    expect(out.warnings).toEqual([{ type: 'field-added', path: 'm.c' }])
  })

  it('flags a scalar type change as a regression', () => {
    const out = emptyOut()
    diffShape(describeShape({ a: 1 }), describeShape({ a: 'x' }), 'm', out)
    expect(out.regressions).toEqual([
      { type: 'scalar-type-changed', path: 'm.a', from: 'number', to: 'string' }
    ])
  })

  it('flags a container type change as a regression', () => {
    const out = emptyOut()
    diffShape(describeShape({ a: [] }), describeShape({ a: {} }), 'm', out)
    expect(out.regressions).toEqual([
      { type: 'type-changed', path: 'm.a', from: 'array', to: 'object' }
    ])
  })

  it('flags array non-empty -> empty as regression, empty -> non-empty as warning', () => {
    const reg = emptyOut()
    diffShape(describeShape([1, 2]), describeShape([]), 'm', reg)
    expect(reg.regressions).toEqual([{ type: 'array-emptied', path: 'm', from: '2-10', to: '0' }])

    const warn = emptyOut()
    diffShape(describeShape([]), describeShape([1]), 'm', warn)
    expect(warn.warnings).toEqual([{ type: 'array-filled', path: 'm', from: '0', to: '1' }])
  })

  it('does not flag non-empty bucket changes (live-data fluctuation)', () => {
    const out = emptyOut()
    diffShape(
      describeShape([1, 2]),
      describeShape(Array.from({ length: 50 }, (_, i) => i)),
      'm',
      out
    )
    expect(out.regressions).toEqual([])
    expect(out.warnings).toEqual([])
  })

  it('treats a nullish leaf as a wildcard so nullable fields never flap', () => {
    const out = emptyOut()
    diffShape(describeShape({ a: null }), describeShape({ a: 5 }), 'm', out)
    diffShape(describeShape({ a: { x: 1 } }), describeShape({ a: null }), 'm', out)
    expect(out.regressions).toEqual([])
    expect(out.warnings).toEqual([])
  })
})

describe('diffSnapshots', () => {
  it('returns no diff for identical snapshots', () => {
    const snap = { methods: { 'x.read': { ok: true, shape: describeShape({ a: 1 }) } } }
    const out = diffSnapshots(snap, snap)
    expect(out.regressions).toEqual([])
    expect(out.warnings).toEqual([])
  })

  it('flags success -> failure as a regression', () => {
    const base = { methods: { 'x.read': { ok: true, shape: describeShape({ a: 1 }) } } }
    const cur = { methods: { 'x.read': { ok: false } } }
    const out = diffSnapshots(base, cur)
    expect(out.regressions).toEqual([{ type: 'call-failed', path: 'x.read' }])
  })

  it('flags recovery and method presence changes as warnings only', () => {
    const base = {
      methods: { 'x.read': { ok: false }, 'y.read': { ok: true, shape: describeShape(1) } }
    }
    const cur = {
      methods: {
        'x.read': { ok: true, shape: describeShape(1) },
        'z.read': { ok: true, shape: describeShape(1) }
      }
    }
    const out = diffSnapshots(base, cur)
    expect(out.regressions).toEqual([])
    expect(out.warnings).toEqual([
      { type: 'call-recovered', path: 'x.read' },
      { type: 'method-absent', path: 'y.read' },
      { type: 'method-added', path: 'z.read' }
    ])
  })
})
