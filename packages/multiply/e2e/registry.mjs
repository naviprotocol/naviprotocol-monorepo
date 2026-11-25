// Read-only mainnet VM checks. Never signs, broadcasts or persists registrations.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { getConfig } from '@naviprotocol/lending'
import { MAINNET_CAP_REGISTRY, ACCOUNT_CAP_TYPE, createNaviDataSource, strategies } from '../dist/index.js'
import { registerCreatedCapPTB } from '../dist/cap-registry.js'

const output = process.env.MULTIPLY_REGISTRY_EVIDENCE ?? '/tmp/multiply-registry-adaptation-evidence'
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
const sender = '0x8e03b330a687ac3819e29b0db75a482ce4c51c93d5bbf9cf3ed559de7d51e317'
const timeout = setTimeout(() => { console.error('Registry verification timed out'); process.exit(1) }, 90_000)
const report = { signed: false, broadcast: false, checksEnabled: false, checks: [] }
const lookup = tx => {
  const index = tx.getData().commands.length
  tx.moveCall({ target: `${MAINNET_CAP_REGISTRY.packageId}::multiply_registry::find_user_mul_account_caps`,
    arguments: [tx.object(MAINNET_CAP_REGISTRY.objectId), tx.pure.address(sender)] })
  return index
}
const simulate = transaction => client.core.simulateTransaction({ transaction, checksEnabled: false,
  include: { commandResults: true, effects: true } })
const status = response => (response.Transaction ?? response.FailedTransaction)?.status
await mkdir(output, { recursive: true })
try {
  const source = createNaviDataSource({ client })
  assert.deepEqual(await source.listAccountCaps(sender), [])
  report.checks.push('empty-registry-reader')
  const config = await getConfig({ disableCache: true })
  const tx = new Transaction(); tx.setSender(sender)
  const cap = tx.moveCall({ target: `${config.package}::lending::create_account` })
  registerCreatedCapPTB(tx, cap, strategies.vsuiSui.registryKey, MAINNET_CAP_REGISTRY)
  const idIndex = tx.getData().commands.length
  tx.moveCall({ target: '0x2::object::id_address', typeArguments: [ACCOUNT_CAP_TYPE], arguments: [cap] })
  const rowIndex = lookup(tx)
  tx.transferObjects([cap], sender)
  const created = await simulate(tx)
  assert.equal(status(created)?.success, true, JSON.stringify(status(created)))
  const value = (i, j = 0) => created.commandResults[i].returnValues[j].bcs
  const capId = bcs.Address.parse(value(idIndex))
  assert.deepEqual(bcs.vector(bcs.u64()).parse(value(rowIndex)), ['1'])
  assert.deepEqual(bcs.vector(bcs.u64()).parse(value(rowIndex, 1)), ['1'])
  assert.deepEqual(bcs.vector(bcs.Address).parse(value(rowIndex, 2)), [capId])
  report.checks.push('create-register-read-atomically-without-metadata')
  tx.moveCall({ target: `${MAINNET_CAP_REGISTRY.packageId}::multiply_registry::register_mul_for_account_cap`,
    arguments: [tx.object(MAINNET_CAP_REGISTRY.objectId), tx.pure.address(capId), tx.pure.u64('1'), tx.pure.u64('1')] })
  const duplicate = await simulate(tx)
  assert.equal(status(duplicate)?.success, false)
  assert.match(JSON.stringify(status(duplicate)), /10001/)
  report.checks.push('duplicate-key-aborts-transaction')
  const read = new Transaction(); read.setSender(sender); lookup(read)
  const after = await simulate(read)
  assert.equal(status(after)?.success, true)
  assert.deepEqual(bcs.vector(bcs.Address).parse(after.commandResults[0].returnValues[2].bcs), [])
  report.checks.push('no-persisted-chain-mutation')
  await writeFile(`${output}/simulation.json`, JSON.stringify({ created, duplicate, after },
    (_, v) => typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? [...v] : v, 2))
  report.passed = true
} catch (error) {
  report.passed = false; report.error = error.message; process.exitCode = 1
} finally {
  clearTimeout(timeout)
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
