import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const sdkPackages = [
  'lending',
  'wallet-client',
  'astros-aggregator-sdk',
  'astros-bridge-sdk',
  'astros-dca-sdk'
]

const forbiddenPublicDeclarationPatterns = [
  { label: '@mysten/sui.js', test: (content) => content.includes('@mysten/sui.js') },
  { label: '@mysten/sui/client', test: (content) => content.includes('@mysten/sui/client') },
  {
    label: 'TransactionBlock',
    test: (content) => /(^|[^A-Za-z0-9_])TransactionBlock([^A-Za-z0-9_]|$)/.test(content)
  },
  {
    label: 'SuiTransactionBlockResponse',
    test: (content) =>
      /(^|[^A-Za-z0-9_])SuiTransactionBlockResponse([^A-Za-z0-9_]|$)/.test(content)
  },
  {
    label: 'DryRunTransactionBlockResponse',
    test: (content) =>
      /(^|[^A-Za-z0-9_])DryRunTransactionBlockResponse([^A-Za-z0-9_]|$)/.test(content)
  }
]

const forbiddenProductionDependencies = new Map([
  [
    '*',
    [
      '@mysten/sui.js',
      '@pythnetwork/pyth-sui-js',
      '@mayanfinance/swap-sdk',
      '@mysten/sui-v1'
    ]
  ],
  ['wallet-client', ['@suilend/sdk', '@suilend/sui-fe']]
])

const issues = []

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    issues.push(`${path.relative(repoRoot, dir)} is missing; build packages before boundary scan`)
    return []
  }

  return fs
    .readdirSync(dir, { recursive: true })
    .map((file) => String(file))
    .filter((file) => fs.statSync(path.join(dir, file)).isFile())
}

for (const packageName of sdkPackages) {
  const packageDir = path.join(repoRoot, 'packages', packageName)
  const packageJson = readJson(path.join(packageDir, 'package.json'))
  const packageExport = packageJson.exports?.['.']

  if (packageJson.type !== 'module') {
    issues.push(`${packageName}: package.json type must be "module"`)
  }

  if (packageExport?.require) {
    issues.push(`${packageName}: package.json exports must not expose require`)
  }

  if (String(packageJson.main ?? '').includes('cjs')) {
    issues.push(`${packageName}: package.json main must not point at CJS output`)
  }

  for (const forbiddenDependency of [
    ...(forbiddenProductionDependencies.get('*') ?? []),
    ...(forbiddenProductionDependencies.get(packageName) ?? [])
  ]) {
    if (packageJson.dependencies?.[forbiddenDependency]) {
      issues.push(`${packageName}: ${forbiddenDependency} must not be a production dependency`)
    }
  }

  const distDir = path.join(packageDir, 'dist')
  const distFiles = listFiles(distDir)

  for (const file of distFiles) {
    const absoluteFile = path.join(distDir, file)
    const relativeFile = path.relative(repoRoot, absoluteFile)
    const content = fs.readFileSync(absoluteFile, 'utf8')
    const isDeclaration = file.endsWith('.d.ts')
    const isRootBundle = file === 'index.esm.js'
    const isBridgeMayanArtifact =
      packageName === 'astros-bridge-sdk' &&
      (file.startsWith('mayan-') || file.startsWith('providers/mayan'))

    if (isDeclaration) {
      for (const pattern of forbiddenPublicDeclarationPatterns) {
        if (pattern.test(content)) {
          issues.push(`${relativeFile}: public declaration contains ${pattern.label}`)
        }
      }
    }

    if (isRootBundle && /\brequire\s*\(/.test(content)) {
      issues.push(`${relativeFile}: root ESM bundle contains require()`)
    }

    if (!isBridgeMayanArtifact && content.includes('@mayanfinance')) {
      issues.push(`${relativeFile}: Mayan dependency is outside bridge lazy adapter artifacts`)
    }
  }
}

if (issues.length > 0) {
  console.error('SDK v2 boundary scan failed:')
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log('SDK v2 boundary scan passed')
