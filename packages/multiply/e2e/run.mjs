import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = path.resolve(process.env.MULTIPLY_E2E_OUT ?? path.join(root, 'out/multiply', new Date().toISOString().replace(/[:.]/g, '-')))
await mkdir(out, { recursive: true })
const artifacts = []
const report = { kind: 'mainnet-e2e-simulation', broadcast: false, startedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: [] }
async function save(name, data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, (_, v) => typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? { base64: Buffer.from(v).toString('base64') } : v, 2)
  await writeFile(path.join(out, name), text + '\n')
  artifacts.push({ file: name, sha256: createHash('sha256').update(text + '\n').digest('hex') })
}
const only = new Set((process.env.MULTIPLY_E2E_ONLY ?? '').split(',').filter(Boolean))
async function scenario(name, fn) {
  if (only.size && !only.has(name)) return
  const start = Date.now()
  try {
    await fn()
    report.scenarios.push({ name, status: 'passed', durationMs: Date.now() - start })
    console.log(`PASS ${name}`)
  } catch (error) {
    report.scenarios.push({ name, status: 'failed', durationMs: Date.now() - start, error: error.stack ?? String(error) })
    console.error(`FAIL ${name}: ${error.message}`)
  }
}
try {
  const entry = process.env.MULTIPLY_E2E_PACKAGE ? pathToFileURL(path.resolve(process.env.MULTIPLY_E2E_PACKAGE)) : new URL('../dist/index.js', import.meta.url)
  const sdk = await import(entry.href)
  const sui = new URL('../../lending/node_modules/@mysten/sui/dist/', import.meta.url)
  const [{ SuiGrpcClient }, { Transaction }, { bcs }, lending] = await Promise.all([
    import(new URL('grpc/index.mjs', sui)), import(new URL('transactions/index.mjs', sui)),
    import(new URL('bcs/index.mjs', sui)), import(new URL('../../lending/dist/index.js', import.meta.url))
  ])
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443' })
  const address = process.env.MULTIPLY_E2E_ADDRESS ?? '0x439f285f559997df4b4ad42c282581b1ca991631ab020a29c8031a0849b7e30f'
  const constraints = { minHealthFactor: '1.15', maxSlippageBps: 50 }
  const source = sdk.createNaviDataSource({ client })
  const engine = sdk.createMultiplyClient({ client, dataSource: source })
  const strategy = sdk.strategies.vsuiSui
  report.address = address
  report.network = await client.core.getChainIdentifier()
  await save('input.json', { address, strategy, constraints })
  const errorCode = code => error => { assert.equal(error.code, code); return true }
  const success = response => {
    const tx = response.Transaction ?? response.FailedTransaction
    assert(tx, 'Missing simulation transaction')
    assert.equal(tx.status.success, true, JSON.stringify(tx.status))
    return tx
  }
  function finish(tx, built) {
    if (built.createdAccountCap) tx.transferObjects([built.createdAccountCap], address)
    if (built.coins.length) tx.transferObjects(built.coins.map(c => c.coin), address)
    tx.setSender(address)
    tx.setGasBudget(500_000_000)
  }
  async function simulate(name, tx, checksEnabled = true) {
    const bytes = await tx.build({ client })
    await save(`${name}.tx.b64`, Buffer.from(bytes).toString('base64'))
    await save(`${name}.commands.json`, tx.getData())
    const result = await client.core.simulateTransaction({ transaction: bytes, checksEnabled, include: { effects: true, events: true, commandResults: true, balanceChanges: true } })
    await save(`${name}.simulation.json`, { checksEnabled, result })
    success(result)
    return result
  }
  async function buildOpen(strat = strategy, instance = engine) {
    const amount = strat.id === sdk.strategies.hasuiSui.id ? '1000000000' : '10000000000'
    const quote = await instance.quote(address, strat, { type: 'open', amount, targetLeverage: '2' }, constraints)
    assert.equal(quote.execution.accountCap.kind, 'create')
    assert(quote.execution.conversions.length > 0)
    assert(Number(quote.estimate.healthFactor) >= Number(constraints.minHealthFactor))
    const tx = new Transaction()
    const coin = tx.splitCoins(tx.gas, [amount])[0]
    const built = await instance.buildPTB(tx, JSON.parse(JSON.stringify(quote)), { coins: [{ coinType: strat.principalCoinType, coin }] })
    assert(built.createdAccountCap)
    assert(!JSON.stringify(tx.getData()).includes('register_emode_for_account_cap'))
    return { tx, built, quote }
  }
  await scenario('discovery', async () => {
    const positions = await engine.getPosition(address, { strategy })
    await save('positions.json', positions)
    assert(Array.isArray(positions))
  })
  await scenario('invalid-inputs', async () => {
    for (const amount of ['0', '-1', '1.5', '18446744073709551616']) {
      await assert.rejects(engine.quote(address, strategy, { type: 'open', amount, targetLeverage: '2' }, constraints), errorCode('INVALID_ARGUMENT'))
    }
    await assert.rejects(engine.quote('bad', strategy, { type: 'close' }, constraints), errorCode('INVALID_ARGUMENT'))
    await assert.rejects(engine.quote(address, strategy, { type: 'open', amount: '10000000000', targetLeverage: '2' }, { ...constraints, maxSlippageBps: -1 }), errorCode('INVALID_ARGUMENT'))
    await assert.rejects(engine.quote(address, strategy, { type: 'repay', amount: '1' }, constraints), errorCode('POSITION_NOT_FOUND'))
  })
  let seed
  await scenario('open-volo', async () => {
    seed = await buildOpen()
    assert(seed.quote.execution.conversions.every(q => q.converterId === 'volo'))
    await save('open-volo.quote.json', seed.quote)
    const tx = Transaction.from(seed.tx)
    finish(tx, seed.built)
    await simulate('open-volo', tx)
  })
  await scenario('open-haedal', async () => {
    const { tx, built, quote } = await buildOpen(sdk.strategies.hasuiSui)
    assert(quote.execution.conversions.every(q => q.converterId === 'haedal'))
    await save('open-haedal.quote.json', quote)
    finish(tx, built)
    await simulate('open-haedal', tx)
  })
  await scenario('default-fallback', async () => {
    const fallbackEngine = sdk.createMultiplyClient({ client, dataSource: source, converters: [] })
    const { tx, built, quote } = await buildOpen(strategy, fallbackEngine)
    assert(quote.execution.conversions.every(q => q.converterId === 'astros'))
    await save('default-fallback.quote.json', quote)
    finish(tx, built)
    await simulate('default-fallback', tx)
  })
  await scenario('quote-guards', async () => {
    const { quote } = seed ?? await buildOpen()
    for (const mutation of [q => { q.expiresAt = 0 }, q => { q.action.amount = '1' }, q => { q.execution.conversions[0].minOutput.amount = '1' }]) {
      const changed = JSON.parse(JSON.stringify(quote))
      mutation(changed)
      const tx = new Transaction()
      const before = JSON.stringify(tx.getData())
      await assert.rejects(engine.buildPTB(tx, changed, { coins: [] }))
      assert.equal(JSON.stringify(tx.getData()), before)
    }
    await assert.rejects(engine.quote(address, strategy, { type: 'open', amount: '10000000000', targetLeverage: '20' }, constraints))
  })
  // Real VM-backed transient position: read actual balances/indices, not model fixtures.
  async function transient() {
    seed ??= await buildOpen()
    const market = await source.readMarket(strategy)
    const tx = Transaction.from(seed.tx)
    const owner = tx.moveCall({ target: `${market.config.package}::account::account_owner`, arguments: [seed.built.createdAccountCap] })
    const reservesIndex = tx.getData().commands.length
    tx.moveCall({ target: `${market.config.uiGetter}::getter::get_reserve_data`, arguments: [tx.object(market.config.storage)] })
    const stateIndex = tx.getData().commands.length
    tx.moveCall({ target: `${market.config.uiGetter}::getter_unchecked::get_user_state`, arguments: [tx.object(market.config.storage), owner] })
    finish(tx, seed.built)
    const res = await simulate('seed-probe', tx, false)
    const read = index => Uint8Array.from(res.commandResults[index].returnValues[0].bcs)
    const reserves = bcs.vector(lending.ReserveDataInfo).parse(read(reservesIndex))
    const states = bcs.vector(lending.UserStateInfo).parse(read(stateIndex))
    await save('seed-state.json', { reserves, states })
    const scaled = (id, kind) => {
      const row = states.find(s => s.asset_id === id)
      const reserve = reserves.find(r => r.id === id || r.asset_id === id)
      assert(row && reserve, `Missing state/reserve for ${id}`)
      const index = reserve[kind === 'supply' ? 'supply_index' : 'borrow_index']
      return ((BigInt(row[`${kind}_balance`]) * BigInt(index) + 10n ** 27n / 2n) / 10n ** 27n).toString()
    }
    const position = { collateralAmount: scaled(market.collateral.id, 'supply'), debtAmount: scaled(market.debt.id, 'borrow') }
    // Logical ID is only a transient fixture key. The actual Cap is the PTB result.
    const cap = { id: '0x' + '1'.repeat(64), accountOwner: '0x' + '1'.repeat(64), strategyId: strategy.id, name: `navi:multiply:v1:${strategy.id}` }
    const scoped = { ...source, listAccountCaps: async () => [cap], readPosition: async () => position }
    return { scoped, position }
  }
  const actions = [
    ['add-principal', { type: 'add_principal', amount: '1000000000' }],
    ['remove-principal', { type: 'remove_principal', amount: '1000000000' }],
    ['leverage-up', { type: 'set_leverage', targetLeverage: '2.2' }],
    ['leverage-down', { type: 'set_leverage', targetLeverage: '1.5' }],
    ['repay', { type: 'repay', amount: '1000000000' }],
    ['add-collateral', { type: 'add_collateral', amount: '1000000000' }],
    ['close', { type: 'close' }]
  ]
  let fixture
  for (const [name, action] of actions) await scenario(name, async () => {
    fixture ??= await transient()
    const instance = sdk.createMultiplyClient({ client, dataSource: fixture.scoped })
    const quote = await instance.quote(address, strategy, action, constraints)
    await save(`${name}.quote.json`, quote)
    const tx = Transaction.from(seed.tx)
    const coins = []
    for (const input of quote.estimate.inputs) {
      const suiCoin = tx.splitCoins(tx.gas, [input.amount])[0]
      if (input.coinType === strategy.principalCoinType) coins.push({ ...input, coin: suiCoin })
      else {
        const converter = sdk.voloConverter({ client })
        const conversion = await converter.quote({ coinIn: strategy.principalCoinType, coinOut: input.coinType, amountIn: (BigInt(input.amount) * 2n).toString(), slippageBps: 10 })
        // Supply enough real LST, then pass an exact-sized input and return remainder.
        const funding = tx.splitCoins(tx.gas, [conversion.input.amount])[0]
        const result = await converter.buildPTB(tx, conversion, funding)
        coins.push({ coinType: input.coinType, coin: tx.splitCoins(result.coinOut, [input.amount])[0] })
        tx.transferObjects([suiCoin, result.coinOut, ...result.change.map(c => c.coin)], address)
      }
    }
    const built = await instance.buildPTB(tx, quote, { coins, accountCap: seed.built.createdAccountCap })
    finish(tx, { coins: [...seed.built.coins, ...built.coins], createdAccountCap: seed.built.createdAccountCap })
    await simulate(name, tx)
    if (name === 'close') assert.equal(quote.estimate.leverage, null)
  })
} catch (error) {
  report.scenarios.push({ name: 'bootstrap', status: 'failed', error: error.stack ?? String(error) })
  console.error(error.message)
} finally {
  report.finishedAt = new Date().toISOString()
  report.success = report.scenarios.length > 0 && report.scenarios.every(s => s.status === 'passed')
  await save('report.json', report)
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n')
  console.log(`Evidence: ${out}`)
  if (!report.success) process.exitCode = 1
}
