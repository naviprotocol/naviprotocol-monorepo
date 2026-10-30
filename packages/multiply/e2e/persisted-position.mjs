// Real persisted mainnet position -> public package -> quote -> unsigned VM simulation.
// No mocked source, private key, signing or broadcast. Fixture must remain active/owned.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'

const address = process.env.MULTIPLY_E2E_POSITION_ADDRESS
const capId = process.env.MULTIPLY_E2E_CAP_ID
assert(address && capId, 'Set MULTIPLY_E2E_POSITION_ADDRESS and MULTIPLY_E2E_CAP_ID to an active vSUI Multiply position')
const out = path.resolve(process.env.MULTIPLY_E2E_OUT ?? `/tmp/multiply-persisted-${Date.now()}`)
await mkdir(out, { recursive: false })
const entry = process.env.MULTIPLY_E2E_PACKAGE
  ? pathToFileURL(path.resolve(process.env.MULTIPLY_E2E_PACKAGE))
  : new URL('../dist/index.js', import.meta.url)
const hash = (data) => createHash('sha256').update(data).digest('hex')
const dist = path.dirname(fileURLToPath(entry))
const distributionFiles = await Promise.all(
  (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter((item) => item.isFile())
    .map(async (item) => {
      const filename = path.join(item.parentPath, item.name)
      return { file: path.relative(dist, filename), sha256: hash(await readFile(filename)) }
    })
)
distributionFiles.sort((a, b) => a.file.localeCompare(b.file))
const artifacts = []
async function save(file, value) {
  const text = JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n'
  await writeFile(path.join(out, file), text, { flag: 'wx' })
  artifacts.push({ file, sha256: hash(text) })
}
const report = { broadcast: false, signed: false, startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  distributionSha256: hash(JSON.stringify(distributionFiles)), address, capId, checks: [] }
try {
  await save('distribution-files.json', distributionFiles)
  const sdk = await import(entry.href)
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443' })
  const { object } = await client.core.getObject({ objectId: capId, include: { json: true } })
  await save('chain-cap.json', object)
  assert.equal(object.owner.AddressOwner, address, 'Fixture Cap must still belong to this wallet')
  const engine = sdk.createMultiplyClient({ client })
  const strategy = sdk.strategies.vsuiSui
  const all = await engine.getPosition(address)
  await save('positions.json', all)
  const matches = all.filter((p) => p.strategy.id === strategy.id)
  assert.equal(matches.length, 1, 'Persisted active Multiply position must be discovered exactly once')
  const p = matches[0]
  assert.equal(p.accountCap.id, capId)
  assert.equal(p.accountCap.accountOwner, object.json.owner)
  assert.equal(p.accountCap.name, `navi:multiply:v1:${strategy.id}`)
  assert(BigInt(p.collateralAmount) > 0n && BigInt(p.debtAmount) > 0n)
  assert(Number(p.healthFactor) > 1 && Number(p.leverage) > 1)
  const filtered = await engine.getPosition(address, { strategy })
  await save('filtered-positions.json', filtered)
  assert.deepEqual(filtered.map((v) => v.accountCap.id), [capId])
  report.checks.push('all-and-filtered-discovery')
  const constraints = { minHealthFactor: '1.08', maxSlippageBps: 50 }
  await assert.rejects(
    engine.quote(address, strategy, { type: 'open', amount: '1000000000', targetLeverage: '2' }, constraints),
    (error) => error.code === 'POSITION_EXISTS'
  )
  report.checks.push('duplicate-open-rejected')
  const quote = await engine.quote(address, strategy, { type: 'repay', amount: '1000000' }, constraints)
  await save('repay-quote.json', quote)
  assert.equal(quote.execution.accountCap.kind, 'existing')
  assert.equal(quote.execution.accountCap.id, capId)
  const tx = new Transaction()
  const built = await engine.buildPTB(tx, quote, { coins: [{ coinType: strategy.debtCoinType, coin: tx.splitCoins(tx.gas, ['1000000'])[0] }] })
  assert(!built.createdAccountCap, 'Existing position must never create a second Cap')
  if (built.coins.length) tx.transferObjects(built.coins.map((v) => v.coin), address)
  tx.setSender(address)
  tx.setGasBudget(500_000_000)
  const bytes = await tx.build({ client })
  await save('repay-transaction.json', { bytes: Buffer.from(bytes).toString('base64'), commands: tx.getData() })
  const result = await client.core.simulateTransaction({ transaction: bytes, checksEnabled: true, include: { effects: true, events: true, balanceChanges: true } })
  await save('repay-simulation.json', result)
  assert.equal((result.Transaction ?? result.FailedTransaction).status.success, true)
  report.checks.push('existing-cap-repay-simulation')
  report.success = true
} catch (error) {
  report.success = false
  report.error = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  await save('report.json', report)
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ ...report, out }))
}
