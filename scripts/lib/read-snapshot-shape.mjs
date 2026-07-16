// Pure, deterministic normalization + diff logic for the read-snapshot regression
// scope. Kept framework-free and side-effect-free so it can be unit tested in
// isolation (see test/regression/read-snapshot-shape.test.mjs).

export const MAX_SHAPE_DEPTH = 12

export function sizeBucket(length) {
  if (length === 0) return '0'
  if (length === 1) return '1'
  if (length <= 10) return '2-10'
  return '10+'
}

// Normalize a value into a structure/contract descriptor. Concrete values are
// erased on purpose: only the SHAPE survives (key paths + type category + array
// fill bucket). This is what makes the snapshot stable against live-data drift
// (balances, prices, health factors, digests, cursors, timestamps, versions...):
// their leaves collapse to `{ type: 'number' | 'string' | ... }` with no value.
export function describeShape(value, depth = 0) {
  if (depth > MAX_SHAPE_DEPTH) return { type: 'truncated' }
  if (value === null) return { type: 'null' }
  if (value === undefined) return { type: 'undefined' }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      size: sizeBucket(value.length),
      // Arrays are homogeneous by contract: sample the first element's shape.
      element: value.length ? describeShape(value[0], depth + 1) : null
    }
  }
  const t = typeof value
  if (t === 'object') {
    const keys = Object.keys(value).sort()
    const fields = {}
    for (const key of keys) {
      fields[key] = describeShape(value[key], depth + 1)
    }
    return { type: 'object', keys, fields }
  }
  // Scalar leaf: keep only the type name, never the value.
  return { type: t }
}

export function nodeKind(node) {
  if (!node) return 'nullish'
  if (node.type === 'array') return 'array'
  if (node.type === 'object') return 'object'
  if (node.type === 'null' || node.type === 'undefined') return 'nullish'
  return 'scalar'
}

// Recursive shape diff. Regressions (field removed / container-type change /
// scalar-type change / array non-empty->empty) fail the run; warnings (field
// added / array empty->non-empty) are reported but do not fail. A nullish leaf
// on either side is treated as a wildcard so nullable fields never flap.
export function diffShape(base, cur, path, out) {
  const bk = nodeKind(base)
  const ck = nodeKind(cur)
  if (bk === 'nullish' || ck === 'nullish') return
  if (bk !== ck) {
    out.regressions.push({ type: 'type-changed', path, from: bk, to: ck })
    return
  }
  if (bk === 'array') {
    const baseEmpty = base.size === '0'
    const curEmpty = cur.size === '0'
    if (!baseEmpty && curEmpty) {
      out.regressions.push({ type: 'array-emptied', path, from: base.size, to: cur.size })
    } else if (baseEmpty && !curEmpty) {
      out.warnings.push({ type: 'array-filled', path, from: base.size, to: cur.size })
    }
    if (base.element && cur.element) {
      diffShape(base.element, cur.element, `${path}[]`, out)
    }
    return
  }
  if (bk === 'object') {
    for (const key of base.keys) {
      if (!cur.keys.includes(key)) {
        out.regressions.push({ type: 'field-missing', path: `${path}.${key}` })
      } else {
        diffShape(base.fields[key], cur.fields[key], `${path}.${key}`, out)
      }
    }
    for (const key of cur.keys) {
      if (!base.keys.includes(key)) {
        out.warnings.push({ type: 'field-added', path: `${path}.${key}` })
      }
    }
    return
  }
  // both scalar
  if (base.type !== cur.type) {
    out.regressions.push({ type: 'scalar-type-changed', path, from: base.type, to: cur.type })
  }
}

export function diffSnapshots(baseline, current) {
  const out = { regressions: [], warnings: [] }
  const baseMethods = baseline.methods ?? {}
  const curMethods = current.methods ?? {}
  const names = [...new Set([...Object.keys(baseMethods), ...Object.keys(curMethods)])].sort()
  for (const name of names) {
    const b = baseMethods[name]
    const c = curMethods[name]
    if (b && !c) {
      out.warnings.push({ type: 'method-absent', path: name })
      continue
    }
    if (!b && c) {
      out.warnings.push({ type: 'method-added', path: name })
      continue
    }
    if (b.ok && !c.ok) {
      out.regressions.push({ type: 'call-failed', path: name })
      continue
    }
    if (!b.ok && c.ok) {
      out.warnings.push({ type: 'call-recovered', path: name })
      continue
    }
    if (b.ok && c.ok) {
      diffShape(b.shape, c.shape, name, out)
    }
  }
  return out
}
