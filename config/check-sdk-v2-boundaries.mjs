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
    test: (content) => /(^|[^A-Za-z0-9_])SuiTransactionBlockResponse([^A-Za-z0-9_]|$)/.test(content)
  },
  {
    label: 'DryRunTransactionBlockResponse',
    test: (content) =>
      /(^|[^A-Za-z0-9_])DryRunTransactionBlockResponse([^A-Za-z0-9_]|$)/.test(content)
  }
]

const forbiddenProductionDependencies = new Map([
  ['*', ['@mysten/sui.js', '@pythnetwork/pyth-sui-js', '@mayanfinance/swap-sdk', '@mysten/sui-v1']],
  ['wallet-client', ['@suilend/sdk', '@suilend/sui-fe']]
])

const requiredLazyPeerRanges = {
  'wallet-client': {
    '@suilend/sdk': /^(\^)?3\./,
    '@suilend/sui-fe': /^(\^)?3\./
  }
}

const issues = []

function toPosixPath(filePath) {
  return String(filePath).split(path.sep).join('/')
}

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

function assertRequiredDistFiles(packageName, distFiles) {
  const normalizedFiles = new Set(distFiles.map(toPosixPath))
  for (const requiredFile of ['index.esm.js', 'index.d.ts']) {
    if (!normalizedFiles.has(requiredFile)) {
      issues.push(`${packageName}: dist/${requiredFile} is missing; run build before boundary scan`)
    }
  }
}

function assertPackageRange(packageName, packageJson, dependencyName, matcher) {
  const peerRange = packageJson.peerDependencies?.[dependencyName]
  const devRange = packageJson.devDependencies?.[dependencyName]

  if (!peerRange || !matcher.test(peerRange)) {
    issues.push(`${packageName}: ${dependencyName} peer range must be SDK v2-compatible`)
  }

  if (!devRange || !matcher.test(devRange)) {
    issues.push(`${packageName}: ${dependencyName} dev range must be SDK v2-compatible`)
  }
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

  for (const [dependencyName, matcher] of Object.entries(
    requiredLazyPeerRanges[packageName] ?? {}
  )) {
    assertPackageRange(packageName, packageJson, dependencyName, matcher)
  }

  const distDir = path.join(packageDir, 'dist')
  const distFiles = listFiles(distDir)
  assertRequiredDistFiles(packageName, distFiles)

  for (const file of distFiles) {
    const normalizedFile = toPosixPath(file)
    const absoluteFile = path.join(distDir, file)
    const relativeFile = path.relative(repoRoot, absoluteFile)
    const content = fs.readFileSync(absoluteFile, 'utf8')
    const isDeclaration = normalizedFile.endsWith('.d.ts')
    const isRootBundle = normalizedFile === 'index.esm.js'
    const isBridgeMayanArtifact =
      packageName === 'astros-bridge-sdk' &&
      (normalizedFile.startsWith('mayan-') || normalizedFile.startsWith('providers/mayan'))
    const isWalletSuilendArtifact =
      packageName === 'wallet-client' &&
      (normalizedFile.startsWith('suilend-') ||
        normalizedFile.startsWith('modules/lendingModule/protocols/suilend'))

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

    if (!isBridgeMayanArtifact && content.includes('@mysten/sui-v1')) {
      issues.push(`${relativeFile}: Sui v1 alias is outside bridge lazy adapter artifacts`)
    }

    if (!isWalletSuilendArtifact && content.includes('@suilend/')) {
      issues.push(
        `${relativeFile}: Suilend dependency is outside wallet-client lazy adapter artifacts`
      )
    }
  }
}

const lockfilePath = path.join(repoRoot, 'pnpm-lock.yaml')
if (fs.existsSync(lockfilePath)) {
  const lockfile = fs.readFileSync(lockfilePath, 'utf8')
  for (const forbiddenLockMarker of ['@suilend/sdk@1.', '@suilend/sui-fe@0.']) {
    if (lockfile.includes(forbiddenLockMarker)) {
      issues.push(`pnpm-lock.yaml: contains old Suilend marker ${forbiddenLockMarker}`)
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
