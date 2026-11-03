import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = path.resolve(
  process.env.MULTIPLY_E2E_OUT ??
    path.join(root, 'out/multiply', new Date().toISOString().replace(/[:.]/g, '-'))
)
await mkdir(out, { recursive: true })
const artifacts = []
const report = {
  kind: 'mainnet-e2e-simulation',
  broadcast: false,
  startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scenarios: []
}
async function save(name, data) {
  const text =
    typeof data === 'string'
      ? data
      : JSON.stringify(
          data,
          (_, v) =>
            typeof v === 'bigint'
              ? String(v)
              : v instanceof Uint8Array
                ? { base64: Buffer.from(v).toString('base64') }
                : v,
          2
        )
  await writeFile(path.join(out, name), text + '\n', { flag: 'wx' })
  artifacts.push({
    file: name,
    sha256: createHash('sha256')
      .update(text + '\n')
      .digest('hex')
  })
}
const only = new Set((process.env.MULTIPLY_E2E_ONLY ?? '').split(',').filter(Boolean))
report.fullSuite = only.size === 0
report.selectedScenarios = [...only]
async function scenario(name, fn) {
  if (only.size && !only.has(name)) return
  const start = Date.now()
  const attempts = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const artifactStart = artifacts.length
    try {
      await fn()
      attempts.push({ attempt, status: 'passed' })
      report.scenarios.push({ name, status: 'passed', attempts, durationMs: Date.now() - start })
      console.log(`PASS ${name}${attempt > 1 ? ` (after ${attempt} attempts)` : ''}`)
      return
    } catch (error) {
      const transportFailure = error instanceof TypeError && error.message === 'fetch failed'
      const failure = {
        attempt,
        status: 'failed',
        transportFailure,
        error: error.stack ?? String(error),
        cause: error.cause?.message
      }
      attempts.push(failure)
      if (transportFailure && attempt === 1) {
        // Preserve the failed attempt. Never overwrite it or retry VM/assertion failures.
        for (const item of artifacts.slice(artifactStart)) {
          const archived = `${name}.attempt-${attempt}.${item.file}`
          await rename(path.join(out, item.file), path.join(out, archived))
          item.file = archived
        }
        console.error(`RETRY ${name}: fetch failed; first-attempt evidence retained`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      report.scenarios.push({
        name,
        status: 'failed',
        attempts,
        durationMs: Date.now() - start,
        error: failure.error
      })
      console.error(`FAIL ${name}: ${error.message}`)
      return
    }
  }
}
try {
  const provenanceFiles = execFileSync(
    'git',
    [
      'ls-files',
      'packages/multiply',
      'packages/astros-aggregator-sdk/src',
      'packages/lending/src',
      'config',
      'pnpm-lock.yaml',
      'package.json'
    ],
    { cwd: root, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  const provenance = []
  for (const file of provenanceFiles)
    provenance.push({
      file,
      sha256: createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex')
    })
  await save('source-manifest.json', provenance)
  report.workingTree = execFileSync('git', ['status', '--short'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
  const entry = process.env.MULTIPLY_E2E_PACKAGE
    ? pathToFileURL(path.resolve(process.env.MULTIPLY_E2E_PACKAGE))
    : new URL('../dist/index.js', import.meta.url)
  const sdk = await import(entry.href)
  const sui = process.env.MULTIPLY_E2E_SUI_DIST
    ? pathToFileURL(path.resolve(process.env.MULTIPLY_E2E_SUI_DIST) + path.sep)
    : new URL('../../lending/node_modules/@mysten/sui/dist/', import.meta.url)
  const [{ SuiGrpcClient }, { Transaction }, { bcs }, lending] = await Promise.all([
    import(new URL('grpc/index.mjs', sui)),
    import(new URL('transactions/index.mjs', sui)),
    import(new URL('bcs/index.mjs', sui)),
    import(process.env.MULTIPLY_E2E_LENDING
      ? pathToFileURL(path.resolve(process.env.MULTIPLY_E2E_LENDING)).href
      : new URL('../../lending/dist/index.js', import.meta.url).href)
  ])
  const client = new SuiGrpcClient({
    network: 'mainnet',
    baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443'
  })
  const address =
    process.env.MULTIPLY_E2E_ADDRESS ??
    '0x39c70d4ce3ce769a46f46ad80184a88bc25be9b49545751f5425796ef0c3d9ba'
  const constraints = { minHealthFactor: '1.15', maxSlippageBps: 50, maxLeverage: '3' }
  const source = sdk.createNaviDataSource({ client })
  const engine = sdk.createMultiplyClient({ client, dataSource: source })
  const strategy = sdk.strategies.vsuiSui
  report.address = address
  report.network = await client.core.getChainIdentifier()
  await save('input.json', { address, strategy, constraints })
  const errorCode = (code) => (error) => {
    assert.equal(error.code, code)
    return true
  }
  const success = (response) => {
    const tx = response.Transaction ?? response.FailedTransaction
    assert(tx, 'Missing simulation transaction')
    assert.equal(tx.status.success, true, JSON.stringify(tx.status))
    return tx
  }
  function finish(tx, built) {
    if (built.createdAccountCap) tx.transferObjects([built.createdAccountCap], address)
    if (built.coins.length)
      tx.transferObjects(
        built.coins.map((c) => c.coin),
        address
      )
    tx.setSender(address)
    tx.setGasBudget(500_000_000)
  }
  async function simulate(name, tx, checksEnabled = true) {
    const bytes = await tx.build({ client })
    await save(`${name}.tx.b64`, Buffer.from(bytes).toString('base64'))
    await save(`${name}.commands.json`, tx.getData())
    const result = await client.core.simulateTransaction({
      transaction: bytes,
      checksEnabled,
      include: { effects: true, events: true, commandResults: true, balanceChanges: true }
    })
    await save(`${name}.simulation.json`, { checksEnabled, result })
    success(result)
    return result
  }
  function appendProbe(tx, cap, market) {
    const owner = tx.moveCall({
      target: `${market.config.package}::account::account_owner`,
      arguments: [cap]
    })
    const reserves = tx.getData().commands.length
    tx.moveCall({
      target: `${market.config.uiGetter}::getter::get_reserve_data`,
      arguments: [tx.object(market.config.storage)]
    })
    const state = tx.getData().commands.length
    tx.moveCall({
      target: `${market.config.uiGetter}::getter_unchecked::get_user_state`,
      arguments: [tx.object(market.config.storage), owner]
    })
    const hf = tx.getData().commands.length
    tx.moveCall({
      target: `${market.config.package}::logic::user_health_factor`,
      arguments: [
        tx.object('0x6'),
        tx.object(market.config.storage),
        tx.object(market.config.priceOracle),
        owner
      ]
    })
    const capId = tx.getData().commands.length
    tx.moveCall({ target: '0x2::object::id_address', typeArguments: [sdk.ACCOUNT_CAP_TYPE], arguments: [cap] })
    const registry = tx.getData().commands.length
    tx.moveCall({ target: `${sdk.MAINNET_CAP_REGISTRY.packageId}::multiply_registry::find_user_mul_account_caps`,
      arguments: [tx.object(sdk.MAINNET_CAP_REGISTRY.objectId), tx.pure.address(tx.getData().sender)] })
    return { reserves, state, hf, capId, registry }
  }
  async function assertOutcome(name, response, probe, quote) {
    const value = (index, field = 0) => response.commandResults[index].returnValues[field].bcs
    const reserves = bcs.vector(lending.ReserveDataInfo).parse(value(probe.reserves))
    const states = bcs.vector(lending.UserStateInfo).parse(value(probe.state))
    const amount = (id, side) => {
      const state = states.find((s) => s.asset_id === id)
      if (!state) return 0n
      const reserve = reserves.find((r) => r.id === id)
      assert(reserve)
      return (
        (BigInt(state[`${side}_balance`]) * BigInt(reserve[`${side}_index`]) + 10n ** 27n / 2n) /
        10n ** 27n
      )
    }
    const collateral = amount(quote.execution.market.collateral.id, 'supply')
    const debt = amount(quote.execution.market.debt.id, 'borrow')
    const hfRay = BigInt(bcs.u256().parse(value(probe.hf)))
    const capId = bcs.Address.parse(value(probe.capId))
    const ids = bcs.vector(bcs.u64()).parse(value(probe.registry, 0))
    const versions = bcs.vector(bcs.u64()).parse(value(probe.registry, 1))
    const caps = bcs.vector(bcs.Address).parse(value(probe.registry, 2))
    const registration = ids.findIndex((id, i) => id === quote.strategy.registryKey.strategyNumericId && versions[i] === quote.strategy.registryKey.strategyVersion)
    assert(registration >= 0, 'Strategy must be registered in the same PTB')
    assert.equal(caps[registration], capId)
    assert(hfRay >= BigInt(Math.ceil(Number(quote.constraints.minHealthFactor) * 1e6)) * 10n ** 21n)
    if (quote.action.type === 'close') {
      assert.equal(collateral, 0n, 'Close must clear collateral on chain')
      assert.equal(debt, 0n, 'Close must clear debt on chain')
    } else {
      assert(
        collateral + 1000n >= BigInt(quote.execution.minCollateralAfter),
        'Actual collateral below quoted minimum'
      )
      const expectedDebt = BigInt(quote.execution.debtAfter)
      assert(
        debt <= expectedDebt + expectedDebt / 10000n + 1000n,
        'Actual debt exceeds the interest bound'
      )
      assert(debt + 1000n >= expectedDebt, 'Debt action did not execute')
    }
    await save(`${name}.outcome.json`, { collateral, debt, hfRay, capId, registryKey: quote.strategy.registryKey, reserves, states })
  }
  async function executeAndCheck(name, tx, built, quote) {
    const data = tx.getData()
    const refunds = data.commands.filter(
      (c) => c.$kind === 'MoveCall' && c.MoveCall.module === 'coin_utils' &&
        c.MoveCall.function === 'transfer_nonzero'
    )
    if (quote.execution.conversions.some((q) => q.converterId === 'astros')) {
      assert(refunds.length > 0, 'Astros must return route change directly')
    }
    for (const refund of refunds) {
      const recipient = refund.MoveCall.arguments[1]
      assert.equal(recipient.$kind, 'Input', 'Refund recipient must be the quoted address')
      const input = data.inputs[recipient.Input]
      assert.equal(input.$kind, 'Pure')
      assert.equal(
        bcs.Address.parse(Buffer.from(input.Pure.bytes, 'base64')),
        quote.address,
        'Route change must go to the quote owner, not the sender or zero address'
      )
    }
    assert(
      !tx.getData().commands.some((c) => c.$kind === 'TransferObjects'),
      'Engine must not transfer final assets'
    )
    const probe = appendProbe(
      tx,
      built.accountCap ?? built.createdAccountCap,
      quote.execution.market
    )
    finish(tx, built)
    const result = await simulate(name, tx)
    await assertOutcome(name, result, probe, quote)
  }
  async function buildOpen(strat = strategy, instance = engine, inputAmount) {
    const amount = inputAmount ?? (strat.id === sdk.strategies.hasuiSui.id ? '1000000000' : '10000000000')
    const quote = await instance.quote(
      address,
      strat,
      { type: 'open', amount, targetLeverage: '2' },
      constraints
    )
    assert.equal(quote.execution.accountCap.kind, 'create')
    assert(quote.execution.conversions.length > 0)
    assert(Number(quote.estimate.healthFactor) >= Number(constraints.minHealthFactor))
    const tx = new Transaction()
    // Registry ownership follows sender: reject another executor before PTB mutation.
    tx.setSender('0x42')
    const coin = tx.splitCoins(tx.gas, [amount])[0]
    const before = JSON.stringify(tx.getData())
    await assert.rejects(instance.buildPTB(tx, quote, {
      coins: [{ coinType: strat.principalCoinType, coin }]
    }), errorCode('INVALID_INPUTS'))
    assert.equal(JSON.stringify(tx.getData()), before)
    tx.setSender(address)
    const built = await instance.buildPTB(tx, JSON.parse(JSON.stringify(quote)), {
      coins: [{ coinType: strat.principalCoinType, coin }]
    })
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
    await assert.rejects(
      engine.quote('0x0', strategy, { type: 'open', amount: '1000000000', targetLeverage: '2' }, constraints),
      errorCode('INVALID_ARGUMENT')
    )
    for (const amount of ['0', '-1', '1.5', '18446744073709551616']) {
      await assert.rejects(
        engine.quote(address, strategy, { type: 'open', amount, targetLeverage: '2' }, constraints),
        errorCode('INVALID_ARGUMENT')
      )
    }
    await assert.rejects(
      engine.quote('bad', strategy, { type: 'close' }, constraints),
      errorCode('INVALID_ARGUMENT')
    )
    await assert.rejects(
      engine.quote(
        address,
        strategy,
        { type: 'open', amount: '10000000000', targetLeverage: '2' },
        { ...constraints, maxSlippageBps: -1 }
      ),
      errorCode('INVALID_ARGUMENT')
    )
    await assert.rejects(
      engine.quote(address, strategy, { type: 'repay', amount: '1' }, constraints),
      errorCode('POSITION_NOT_FOUND')
    )
  })
  let seed
  await scenario('open-volo', async () => {
    seed = await buildOpen()
    assert(seed.quote.execution.conversions.every((q) => q.converterId === 'volo'))
    await save('open-volo.quote.json', seed.quote)
    const tx = Transaction.from(seed.tx)
    await executeAndCheck('open-volo', tx, seed.built, seed.quote)
  })
  await scenario('open-haedal', async () => {
    const { tx, built, quote } = await buildOpen(sdk.strategies.hasuiSui)
    assert(quote.execution.conversions.every((q) => q.converterId === 'haedal'))
    await save('open-haedal.quote.json', quote)
    await executeAndCheck('open-haedal', tx, built, quote)
  })
  await scenario('small-haedal-fallback', async () => {
    const { tx, built, quote } = await buildOpen(sdk.strategies.hasuiSui, engine, '10000000')
    await save('small-haedal-fallback.quote.json', quote)
    // Exercise the entire public strategy engine and real VM before route assertions.
    await executeAndCheck('small-haedal-fallback', tx, built, quote)
    assert(quote.execution.conversions.every((q) => q.converterId === 'astros'))
  })
  await scenario('default-fallback', async () => {
    const fallbackEngine = sdk.createMultiplyClient({ client, dataSource: source, converters: [] })
    const { tx, built, quote } = await buildOpen(strategy, fallbackEngine)
    assert(quote.execution.conversions.every((q) => q.converterId === 'astros'))
    const converter = sdk.astrosConverter()
    for (const context of [undefined, { changeRecipient: 'bad' }, { changeRecipient: '0x0' }]) {
      const invalidTx = new Transaction()
      const coin = invalidTx.splitCoins(invalidTx.gas, ['10000000000'])[0]
      const before = JSON.stringify(invalidTx.getData())
      await assert.rejects(
        converter.buildPTB(invalidTx, quote.execution.conversions[0], coin, context),
        errorCode('INVALID_ARGUMENT')
      )
      assert.equal(JSON.stringify(invalidTx.getData()), before, 'Invalid recipient must not mutate PTB')
    }
    await save('default-fallback.quote.json', quote)
    await executeAndCheck('default-fallback', tx, built, quote)
  })
  await scenario('quote-guards', async () => {
    const { quote } = seed ?? (await buildOpen())
    for (const mutation of [
      (q) => {
        q.expiresAt = 0
      },
      (q) => {
        q.action.amount = '1'
      },
      (q) => {
        q.execution.conversions[0].minOutput.amount = '1'
      }
    ]) {
      const changed = JSON.parse(JSON.stringify(quote))
      mutation(changed)
      const tx = new Transaction()
      const before = JSON.stringify(tx.getData())
      await assert.rejects(engine.buildPTB(tx, changed, { coins: [] }))
      assert.equal(JSON.stringify(tx.getData()), before)
    }
    await assert.rejects(
      engine.quote(
        address,
        strategy,
        { type: 'open', amount: '10000000000', targetLeverage: '20' },
        constraints
      )
    )
  })
  await scenario('custom-fallback', async () => {
    const custom = sdk.createMultiplyClient({
      client,
      dataSource: source,
      converters: [],
      fallbackConverter: sdk.voloConverter({ client })
    })
    const { tx, built, quote } = await buildOpen(strategy, custom)
    assert.equal(quote.execution.conversions[0].converterId, 'volo')
    await save('custom-fallback.quote.json', quote)
    await executeAndCheck('custom-fallback', tx, built, quote)
  })
  // Real VM-backed transient position: read actual balances/indices, not model fixtures.
  async function transient(label, strat = strategy) {
    seed = await buildOpen(strat)
    const market = await source.readMarket(strat)
    const tx = Transaction.from(seed.tx)
    const owner = tx.moveCall({
      target: `${market.config.package}::account::account_owner`,
      arguments: [seed.built.createdAccountCap]
    })
    const reservesIndex = tx.getData().commands.length
    tx.moveCall({
      target: `${market.config.uiGetter}::getter::get_reserve_data`,
      arguments: [tx.object(market.config.storage)]
    })
    const stateIndex = tx.getData().commands.length
    tx.moveCall({
      target: `${market.config.uiGetter}::getter_unchecked::get_user_state`,
      arguments: [tx.object(market.config.storage), owner]
    })
    finish(tx, seed.built)
    const res = await simulate(`${label}-seed-probe`, tx, false)
    const read = (index) => Uint8Array.from(res.commandResults[index].returnValues[0].bcs)
    const reserves = bcs.vector(lending.ReserveDataInfo).parse(read(reservesIndex))
    const states = bcs.vector(lending.UserStateInfo).parse(read(stateIndex))
    await save(`${label}-seed-state.json`, { reserves, states })
    const scaled = (id, kind) => {
      const row = states.find((s) => s.asset_id === id)
      const reserve = reserves.find((r) => r.id === id || r.asset_id === id)
      assert(row && reserve, `Missing state/reserve for ${id}`)
      const index = reserve[kind === 'supply' ? 'supply_index' : 'borrow_index']
      return (
        (BigInt(row[`${kind}_balance`]) * BigInt(index) + 10n ** 27n / 2n) /
        10n ** 27n
      ).toString()
    }
    const position = {
      collateralAmount: scaled(market.collateral.id, 'supply'),
      debtAmount: scaled(market.debt.id, 'borrow')
    }
    // Logical ID is only a transient fixture key. The actual Cap is the PTB result.
    const cap = {
      id: '0x' + '1'.repeat(64),
      accountOwner: '0x' + '1'.repeat(64),
      strategyId: strat.id,
      registryKey: strat.registryKey
    }
    const scoped = {
      ...source,
      listAccountCaps: async () => [cap],
      readPosition: async () => position
    }
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
  for (const [name, action] of actions)
    await scenario(name, async () => {
      fixture = await transient(name)
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
          const conversion = await converter.quote({
            coinIn: strategy.principalCoinType,
            coinOut: input.coinType,
            amountIn: (BigInt(input.amount) * 2n).toString(),
            slippageBps: 10
          })
          // Supply enough real LST, then pass an exact-sized input and return remainder.
          const funding = tx.splitCoins(tx.gas, [conversion.input.amount])[0]
          const result = await converter.buildPTB(tx, conversion, funding)
          coins.push({
            coinType: input.coinType,
            coin: tx.splitCoins(result.coinOut, [input.amount])[0]
          })
          tx.transferObjects(
            [suiCoin, result.coinOut, ...result.change.map((c) => c.coin)],
            address
          )
        }
      }
      const built = await instance.buildPTB(tx, quote, {
        coins,
        accountCap: seed.built.createdAccountCap
      })
      const probe = appendProbe(tx, seed.built.createdAccountCap, quote.execution.market)
      finish(tx, {
        coins: [...seed.built.coins, ...built.coins],
        createdAccountCap: seed.built.createdAccountCap
      })
      const result = await simulate(name, tx)
      await assertOutcome(name, result, probe, quote)
      if (name === 'close') assert.equal(quote.estimate.leverage, null)
    })
  await scenario('close-haedal', async () => {
    const strat = sdk.strategies.hasuiSui
    const fixture = await transient('close-haedal', strat)
    const custom = sdk.createMultiplyClient({ client, dataSource: fixture.scoped })
    const quote = await custom.quote(address, strat, { type: 'close' }, constraints)
    assert.equal(quote.execution.conversions[0].converterId, 'haedal')
    await save('close-haedal.quote.json', quote)
    const tx = Transaction.from(seed.tx)
    const built = await custom.buildPTB(tx, quote, {
      coins: [],
      accountCap: seed.built.createdAccountCap
    })
    await executeAndCheck(
      'close-haedal',
      tx,
      {
        ...built,
        createdAccountCap: seed.built.createdAccountCap,
        coins: [...seed.built.coins, ...built.coins]
      },
      quote
    )
  })
} catch (error) {
  report.scenarios.push({
    name: 'bootstrap',
    status: 'failed',
    error: error.stack ?? String(error)
  })
  console.error(error.message)
} finally {
  report.finishedAt = new Date().toISOString()
  report.success =
    report.scenarios.length > 0 && report.scenarios.every((s) => s.status === 'passed')
  await save('report.json', report)
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n', {
    flag: 'wx'
  })
  console.log(`Evidence: ${out}`)
  if (!report.success) process.exitCode = 1
}
