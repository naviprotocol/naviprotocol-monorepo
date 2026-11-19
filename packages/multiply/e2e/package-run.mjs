// Builds Multiply, installs its tarball with published dependencies, then runs public API E2E.
// No credentials, signing or broadcast code exists in this runner.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const bundle = path.resolve(
  process.env.MULTIPLY_E2E_BUNDLE_OUT ??
    path.join(root, 'out/multiply', `package-${new Date().toISOString().replace(/[:.]/g, '-')}`)
)
const consumer = await mkdtemp(path.join(tmpdir(), 'multiply-consumer-'))
await mkdir(bundle, { recursive: true })
const run = (cmd, args, cwd = root, env = process.env) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit' })
run('pnpm', [
  '--filter',
  '@naviprotocol/lending',
  '--filter',
  '@naviprotocol/astros-aggregator-sdk',
  '--filter',
  '@naviprotocol/multiply',
  'build'
])
run('pnpm', ['--filter', '@naviprotocol/multiply', 'typecheck'])
const names = ['multiply']
const dependencies = { '@mysten/sui': '2.20.2' }
const packages = []
for (const name of names) {
  const folder = path.join(root, 'packages', name)
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', bundle], folder)
  const filename = `naviprotocol-${name}-${pkg.version}.tgz`
  const file = path.join(bundle, filename)
  const sha256 = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
  packages.push({ name: pkg.name, version: pkg.version, file: filename, sha256 })
  dependencies[pkg.name] = `file:${file}`
}
const consumerPackage = {
  name: 'multiply-e2e-consumer',
  private: true,
  type: 'module',
  dependencies
}
await writeFile(
  path.join(consumer, 'package.json'),
  JSON.stringify(consumerPackage, null, 2) + '\n'
)
// No local dependency tarballs or overrides: exercise the exact npm dependency graph.
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
await copyFile(path.join(consumer, 'package-lock.json'), path.join(bundle, 'consumer-lock.json'))
await copyFile(path.join(consumer, 'package.json'), path.join(bundle, 'consumer-package.json'))
const provenance = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  consumer,
  packages,
  broadcast: false
}
await writeFile(path.join(bundle, 'packages.json'), JSON.stringify(provenance, null, 2) + '\n', {
  flag: 'wx'
})
const evidence = path.join(bundle, 'e2e')
run(process.execPath, ['packages/multiply/e2e/run.mjs'], root, {
  ...process.env,
  MULTIPLY_E2E_OUT: evidence,
  MULTIPLY_E2E_PACKAGE: path.join(consumer, 'node_modules/@naviprotocol/multiply/dist/index.js'),
  MULTIPLY_E2E_LENDING: path.join(consumer, 'node_modules/@naviprotocol/lending/dist/index.js'),
  MULTIPLY_E2E_SUI_DIST: path.join(consumer, 'node_modules/@mysten/sui/dist/'),
  MULTIPLY_E2E_ONLY: ''
})
run(process.execPath, ['packages/multiply/e2e/verify-evidence.mjs', evidence])
console.log(`Verified tarball consumer and evidence: ${bundle}`)
