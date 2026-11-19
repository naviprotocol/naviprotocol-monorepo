import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const folder = path.resolve(process.argv[2] ?? '')
assert(process.argv[2], 'Usage: node verify-evidence.mjs <evidence-directory>')
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
const names = new Set()
for (const item of manifest) {
  assert.equal(path.basename(item.file), item.file, 'Manifest must contain local file names')
  assert(!names.has(item.file), `Duplicate evidence path: ${item.file}`)
  names.add(item.file)
  const actual = createHash('sha256')
    .update(await readFile(path.join(folder, item.file)))
    .digest('hex')
  assert.equal(actual, item.sha256, `Hash mismatch: ${item.file}`)
}
const report = JSON.parse(await readFile(path.join(folder, 'report.json'), 'utf8'))
assert.equal(report.success, true)
assert.equal(report.broadcast, false)
assert.equal(report.kind, 'mainnet-e2e-simulation')
assert.equal(report.fullSuite, true, 'Subset runs are not full-suite evidence')
const required = [
  'discovery',
  'invalid-inputs',
  'open-volo',
  'open-haedal',
  'small-haedal-fallback',
  'default-fallback',
  'quote-guards',
  'custom-fallback',
  'add-principal',
  'remove-principal',
  'leverage-up',
  'leverage-down',
  'repay',
  'add-collateral',
  'close',
  'close-haedal'
]
assert.deepEqual(report.scenarios.map((s) => s.name).sort(), required.sort())
for (const s of report.scenarios) assert.equal(s.status, 'passed', s.name)
for (const name of required.filter(
  (n) => !['discovery', 'invalid-inputs', 'quote-guards'].includes(n)
)) {
  for (const suffix of ['quote.json', 'commands.json', 'tx.b64', 'simulation.json', 'outcome.json'])
    assert(names.has(`${name}.${suffix}`), `Missing ${name}.${suffix}`)
}
console.log(
  `Verified ${manifest.length} artifact hashes and ${report.scenarios.length} passed E2E scenarios; broadcast=false.`
)
