// NAVI stage_v2 E2E (FAILURE-MATRIX.md "NAVI stage_v2 environment and composite LST prices", ST-01..ST-15).
// Sui mainnet simulation only: nothing is signed or broadcast, no private key is read.
// The stage Cap is created inside each PTB by stage lending and handed to the SDK as a PTB
// result, the way a Volo vault hands over the Cap it holds (stage has no Multiply Registry).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = path.resolve(
  process.env.MULTIPLY_E2E_OUT ??
    path.join(root, 'out/multiply-stage', new Date().toISOString().replace(/[:.]/g, '-'))
)
await mkdir(out, { recursive: true })
const artifacts = []
const report = {
  kind: 'mainnet-e2e-simulation',
  env: 'dev (NAVI stage_v2)',
  broadcast: false,
  startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  scenarios: []
}
const json = (data) =>
  JSON.stringify(
    data,
    (_, v) =>
      typeof v === 'bigint'
        ? String(v)
        : v instanceof Uint8Array
          ? { base64: Buffer.from(v).toString('base64') }
          : v,
    2
  )
const saved = new Map()
async function save(name, data) {
  const text = typeof data === 'string' ? data : json(data)
  const n = (saved.get(name) ?? 0) + 1
  saved.set(name, n)
  if (n > 1) name = name.replace(/(\.[a-z0-9]+)$/, `.retry${n - 1}$1`)
  await writeFile(path.join(out, name), text + '\n', { flag: 'wx' })
  artifacts.push({ file: name, sha256: createHash('sha256').update(text + '\n').digest('hex') })
}
const only = new Set((process.env.MULTIPLY_E2E_ONLY ?? '').split(',').filter(Boolean))
// ST-16: NAVI oracle treats a Pyth publish time later than the chain Clock as stale
// (strategy::is_oracle_price_fresh). A Hermes update fetched a moment ago can be newer than the
// checkpoint a simulation runs at, so the RR is not written and the composite price aborts 1502.
// Only that abort (and a Hermes proxy 429) is retried, at most 8 times, and every retry is recorded.
const CLOCK_RACE = /abort code: 1502, in '0x[0-9a-f]+::calculator::calculate_value'|"abortCode":"1502"[^}]*calculate_value/
async function scenario(name, fn) {
  if (only.size && !only.has(name.split(' ')[0])) return
  const start = Date.now()
  const races = []
  for (let attempt = 1; ; attempt++) {
    try {
      const detail = await fn()
      report.scenarios.push({ name, status: 'passed', durationMs: Date.now() - start, clockRaceRetries: races, detail })
      console.log(`PASS ${name}${races.length ? ` (retried: ${races.map((r) => r.kind).join(', ')})` : ''}`)
      return
    } catch (error) {
      const message = String(error.message)
      const limited = /429 Too Many Requests/.test(message) // NAVI Hermes proxy rate limit
      if (attempt < 9 && (CLOCK_RACE.test(message) || limited)) {
        races.push({ attempt, kind: limited ? 'hermes-429' : 'ST-16', at: new Date().toISOString(), error: message.slice(0, 300) })
        await new Promise((r) => setTimeout(r, limited ? 30000 : 5000))
        continue
      }
      report.scenarios.push({ name, status: 'failed', durationMs: Date.now() - start, clockRaceRetries: races, error: error.stack ?? String(error) })
      console.error(`FAIL ${name}: ${error.message}`)
      return
    }
  }
}

const sdk = await import(new URL('../dist/index.js', import.meta.url).href)
const sui = new URL('../../lending/node_modules/@mysten/sui/dist/', import.meta.url)
const [{ SuiGrpcClient }, { Transaction }, { bcs }, lending] = await Promise.all([
  import(new URL('grpc/index.mjs', sui)),
  import(new URL('transactions/index.mjs', sui)),
  import(new URL('bcs/index.mjs', sui)),
  import(new URL('../../lending/dist/index.js', import.meta.url).href)
])
const grpc = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443'
})
// ST-16: every simulation (SDK reads, tx.build dry runs, the scenario simulations) runs this long
// after the PTB was assembled, as a signed transaction executes after sign + broadcast. It lets the
// chain Clock pass the publish time of a Hermes update fetched just before. Retries stay as a
// recorded fallback.
const EXEC_DELAY_MS = Number(process.env.MULTIPLY_E2E_EXEC_DELAY_MS ?? 2500)
const client = new Proxy(grpc, {
  get(target, prop) {
    if (prop !== 'core') return Reflect.get(target, prop)
    return new Proxy(target.core, {
      get(core, name) {
        const value = Reflect.get(core, name)
        if (name !== 'simulateTransaction' || typeof value !== 'function') return typeof value === 'function' ? value.bind(core) : value
        return async (...args) => {
          await new Promise((r) => setTimeout(r, EXEC_DELAY_MS))
          return value.apply(core, args)
        }
      }
    })
  }
})
const address =
  process.env.MULTIPLY_E2E_ADDRESS ?? '0x39c70d4ce3ce769a46f46ad80184a88bc25be9b49545751f5425796ef0c3d9ba'

// stage_v2 (ENG-5455): fixed ids the dev config must resolve to.
const STAGE = {
  lending: '0x64d89919ad10c78c27385429873334365823ebe21971f6450e58dbe61a5bacc0',
  lendingOriginal: '0x51e18f149666eff167d6bcaf59d0b9edcf6affe7650bb2bc3d5167a8c9f6f6d0',
  oracle: '0xe64be9213b8f66845502634d4b1ed2b4683a5e1aebd5afec6b2eb560dffc93b3',
  limiter: '0x7fb80183295089bb282d0a66017366bb60c3f1942151e8bc89cff9e3407f5811',
  vsuiSuiStorage: '0xc14b1f89747e1035fd06db3f3b6bd884c99037af4563f6a95a94d556fb1fe717',
  rrFeed: '0xadbe2241a66b24ff86ccec9b88b19d4f3ce4e5a8ebe0633a4f9f4d72b5937dcf'
}
// Prod ids a dev PTB must never touch (ST-02).
const PROD = [
  '0x512f28261c1a293f49416d8885b8d5d32bde6dd68a99a0be36fe42b248e6833a',
  '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb',
  '0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca',
  '0x4837ae94425107554c8847721cf9954c1ad8e10520433b9e37dc11c507148bea',
  '0x203728f46eb10d19f8f8081db849c86aa8f2a19341b7fd84d7a0e74f053f6242',
  '0xca441b44943c16be0e6e23c5a955bb971537ea3289ae8016fbf33fffe1fd210f',
  '0x3ccac6515a31a45c138b1e74b7fbc8825263c786f8bd960adcbc109792fb876a',
  '0xaf2bd7ab23e930c77857a228c2b0c1a7c2fe38c2a125fef680570381c3ab7610'
]
const STRATEGY = sdk.strategies.vsuiSui
const constraints = { minHealthFactor: '1.05', maxSlippageBps: 50 }
const PRINCIPAL = '1200000000' // 1.2 SUI: Volo stakes >= 1 SUI; stage borrow liquidity is ~1.4 SUI
const LEVERAGE = '1.5'
const PLACEHOLDER = '0x' + '1'.repeat(64)
const placeholderCap = { id: PLACEHOLDER, accountOwner: PLACEHOLDER, strategyId: STRATEGY.id, registryKey: STRATEGY.registryKey }

const dev = sdk.createNaviDataSource({ client, env: 'dev', strategies: [STRATEGY] })
report.address = address
report.network = await client.core.getChainIdentifier()
await save('input.json', { address, STAGE, PROD, STRATEGY, constraints, PRINCIPAL, LEVERAGE, EXEC_DELAY_MS })

const code = (c) => (error) => {
  assert.equal(error.code, c, `${error.code}: ${error.message}`)
  return true
}
async function rejects(promise, c) {
  await assert.rejects(promise, code(c))
}
const norm = (id) => '0x' + id.replace(/^0x/, '').padStart(64, '0')
async function simulateRaw(name, tx, checksEnabled = true) {
  const bytes = await tx.build({ client })
  await save(`${name}.tx.b64`, Buffer.from(bytes).toString('base64'))
  const result = await client.core.simulateTransaction({
    transaction: bytes,
    checksEnabled,
    include: { effects: true, events: true, commandResults: true, balanceChanges: true, objectTypes: true }
  })
  await save(`${name}.simulation.json`, { checksEnabled, result })
  return result
}
const txOf = (result) => result.Transaction ?? result.FailedTransaction
async function simulate(name, tx, checksEnabled = true) {
  const result = await simulateRaw(name, tx, checksEnabled)
  const t = txOf(result)
  assert(t, 'Missing simulation transaction')
  if (!t.status.success) {
    const text = JSON.stringify(t.status)
    if (text.includes('3200')) throw new Error(`stage outflow limit hit (abort 3200), environment limit, not a pass: ${text}`)
    assert.fail(text)
  }
  return result
}
/** Packages called and objects passed by a PTB (ST-02). */
function references(tx) {
  const data = tx.getData()
  const packages = new Set()
  for (const c of data.commands) if (c.MoveCall) packages.add(norm(c.MoveCall.package))
  const objects = new Set()
  for (const i of data.inputs) {
    const o = i.Object ?? i.UnresolvedObject
    const id = o?.objectId ?? o?.ImmOrOwnedObject?.objectId ?? o?.SharedObject?.objectId ?? o?.Receiving?.objectId
    if (id) objects.add(norm(id))
  }
  return { packages: [...packages].sort(), objects: [...objects].sort() }
}
function assertNoProd(tx) {
  const refs = references(tx)
  const hit = [...refs.packages, ...refs.objects].filter((id) => PROD.includes(id))
  assert.deepEqual(hit, [], `dev PTB references prod ids: ${hit}`)
  return refs
}
function appendProbe(tx, owner, market) {
  const c = market.config
  const at = () => tx.getData().commands.length
  const reserves = at()
  tx.moveCall({ target: `${c.uiGetter}::getter::get_reserve_data`, arguments: [tx.object(c.storage)] })
  const state = at()
  tx.moveCall({ target: `${c.uiGetter}::getter_unchecked::get_user_state`, arguments: [tx.object(c.storage), owner] })
  const hf = at()
  tx.moveCall({ target: `${c.package}::logic::user_health_factor`, arguments: [tx.object('0x6'), tx.object(c.storage), tx.object(c.priceOracle), owner] })
  return { reserves, state, hf }
}
function readProbe(response, probe, market) {
  const v = (i) => response.commandResults[i].returnValues[0].bcs
  const reserves = bcs.vector(lending.ReserveDataInfo).parse(v(probe.reserves))
  const states = bcs.vector(lending.UserStateInfo).parse(v(probe.state))
  const amount = (id, side) => {
    const s = states.find((x) => x.asset_id === id)
    const r = reserves.find((x) => x.id === id)
    return s && r ? (BigInt(s[`${side}_balance`]) * BigInt(r[`${side}_index`]) + 10n ** 27n / 2n) / 10n ** 27n : 0n
  }
  return {
    collateral: amount(market.collateral.id, 'supply'),
    debt: amount(market.debt.id, 'borrow'),
    hf: Number(BigInt(bcs.u256().parse(v(probe.hf)))) / 1e27
  }
}
function finish(tx, cap, coins) {
  tx.transferObjects([cap, ...coins.map((c) => c.coin)], address)
  tx.setSender(address)
  tx.setGasBudget(500_000_000)
}
/** Engine whose only Cap is the PTB-created stage Cap, with the given snapshot (zeros = empty). */
function engineWith(position, source = dev) {
  const scoped = { ...source, listAccountCaps: async () => [placeholderCap], readPosition: async () => position }
  return sdk.createMultiplyClient({ client, dataSource: scoped, strategies: [STRATEGY] })
}
/** create_account + open through the SDK, in one PTB. */
async function openPTB(source = dev) {
  const engine = engineWith({ collateralAmount: '0', debtAmount: '0' }, source)
  const quote = await engine.quote(address, STRATEGY, { type: 'open', amount: PRINCIPAL, targetLeverage: LEVERAGE }, constraints)
  const tx = new Transaction()
  const cap = tx.moveCall({ target: `${quote.execution.market.config.package}::lending::create_account` })
  const coin = tx.splitCoins(tx.gas, [PRINCIPAL])[0]
  const built = await engine.buildPTB(tx, quote, { coins: [{ coinType: STRATEGY.principalCoinType, coin }], accountCap: cap })
  assert.equal(built.createdAccountCap, undefined, 'the SDK must not create a Cap')
  return { quote, tx, cap, built }
}

try {
  await scenario('ST-03 invalid env', async () => {
    // ST-17: 'test' is not an env until its deployment (AccountCap type, Registry) is known.
    for (const env of ['stage', 'DEV', '', null, 1, 'test'])
      assert.throws(() => sdk.createNaviDataSource({ client, env }), code('INVALID_ARGUMENT'))
    assert.throws(() => sdk.createMultiplyClient({ client, env: 'stage' }), code('INVALID_ARGUMENT'))
    assert.throws(() => sdk.createMultiplyClient({ client, env: 'test' }), code('INVALID_ARGUMENT'))
    return { rejected: 8 }
  })

  await scenario('ST-04 env with a custom dataSource', async () => {
    assert.throws(() => sdk.createMultiplyClient({ client, dataSource: dev, env: 'dev' }), code('INVALID_ARGUMENT'))
    sdk.createMultiplyClient({ client, dataSource: dev })
    return { rejected: 1 }
  })

  let devMarket, prodMarket
  await scenario('ST-01 env omitted reads prod; ST-02/ST-12 env dev reads stage_v2 only', async () => {
    prodMarket = await sdk.createNaviDataSource({ client, strategies: [STRATEGY] }).readMarket(STRATEGY)
    devMarket = await dev.readMarket(STRATEGY)
    await save('ST-01.markets.json', {
      prod: { package: prodMarket.config.package, storage: prodMarket.config.storage, limter: prodMarket.config.limter, flash: prodMarket.flash.config.package },
      dev: { package: devMarket.config.package, storage: devMarket.config.storage, limter: devMarket.config.limter, flash: devMarket.flash.config.package, collateral: devMarket.collateral.id, debt: devMarket.debt.id, collateralOracle: devMarket.collateral.oracleId, ltv: devMarket.ltv, lt: devMarket.liquidationThreshold }
    })
    assert(PROD.includes(norm(prodMarket.config.package)), `prod package ${prodMarket.config.package}`)
    assert.equal(norm(devMarket.config.package), STAGE.lending)
    assert.equal(norm(devMarket.config.storage), STAGE.vsuiSuiStorage)
    assert.equal(norm(devMarket.config.limter), STAGE.limiter)
    assert.equal(norm(devMarket.config.oracle.packageId), STAGE.oracle)
    assert.equal(norm(devMarket.flash.config.package), STAGE.lending, 'flash loan from the dev main market')
    assert.equal(devMarket.collateral.id, 0, 'vSUI is reserve 0 of the isolated market')
    assert.equal(devMarket.debt.id, 1, 'SUI is reserve 1 of the isolated market')
    assert.equal(devMarket.collateral.oracleId, 5, 'vSUI keeps oracle id 5')
    return { prodPackage: prodMarket.config.package, devPackage: devMarket.config.package }
  })

  await scenario('ST-07/ST-08/ST-09/ST-10 strategy feed selection', async () => {
    const devFeeds = sdk.selectStrategyFeeds(devMarket.config.oracle.feeds, STRATEGY)
    const prodFeeds = sdk.selectStrategyFeeds(prodMarket.config.oracle.feeds, STRATEGY)
    await save('ST-07.feeds.json', { dev: devFeeds, prod: prodFeeds })
    assert.equal(devFeeds.length, 3)
    assert.deepEqual(devFeeds.filter(sdk.isRatioFeed).map((f) => [f.ratioOracleId, norm(f.feedId)]), [[200, STAGE.rrFeed]])
    const prodRatio = prodMarket.config.oracle.feeds.some((f) => sdk.isRatioFeed(f))
    assert.equal(prodFeeds.length, prodRatio ? 3 : 2, 'prod: own feeds, plus RR only once prod lists one')
    const [vsuiOwn, vsuiRR, suiOwn] = devFeeds
    const bad = [
      [[vsuiOwn, vsuiRR], 'debt has no own feed'],
      [[vsuiRR, suiOwn], 'RR without own feed'],
      [[vsuiOwn, vsuiOwn, vsuiRR, suiOwn], 'two own feeds'],
      [[vsuiOwn, vsuiRR, vsuiRR, suiOwn], 'two RR feeds']
    ]
    for (const [feeds] of bad) assert.throws(() => sdk.selectStrategyFeeds(feeds, STRATEGY), code('MARKET_UNSUPPORTED'))
    return { dev: devFeeds.length, prod: prodFeeds.length, prodHasRatio: prodRatio, rejected: bad.map((b) => b[1]) }
  })

  await scenario('ST-06 dev has no Multiply Registry', async () => {
    await rejects(dev.listAccountCaps(address), 'MARKET_UNSUPPORTED')
    const engine = sdk.createMultiplyClient({ client, env: 'dev', strategies: [STRATEGY] })
    await rejects(engine.quote(address, STRATEGY, { type: 'open', amount: PRINCIPAL, targetLeverage: LEVERAGE }, constraints), 'MARKET_UNSUPPORTED')
    const noCap = sdk.createMultiplyClient({ client, dataSource: { ...dev, listAccountCaps: async () => [] }, strategies: [STRATEGY] })
    await rejects(noCap.quote(address, STRATEGY, { type: 'open', amount: PRINCIPAL, targetLeverage: LEVERAGE }, constraints), 'MARKET_UNSUPPORTED')
    return { rejected: 3 }
  })

  await scenario('ST-19 a refused created-Cap build leaves the PTB untouched', async () => {
    // A prod create-quote handed to a dev client without capRegistry (same default Registry binding, so every earlier
    // check passes) through buildPTBForSimulation, which skips the live Cap reads.
    const prodEngine = sdk.createMultiplyClient({ client, strategies: [STRATEGY] })
    const quote = await prodEngine.quote(address, STRATEGY, { type: 'open', amount: PRINCIPAL, targetLeverage: LEVERAGE }, constraints)
    assert.equal(quote.execution.accountCap.kind, 'create')
    const devEngine = sdk.createMultiplyClient({ client, env: 'dev', strategies: [STRATEGY] })
    const tx = new Transaction()
    tx.setSender(address)
    const coin = tx.splitCoins(tx.gas, [PRINCIPAL])[0]
    const before = tx.getData().commands.length
    // ST-20..ST-22: the env check runs first, so the refusal is now INVALID_QUOTE; the PTB stays untouched either way.
    await rejects(devEngine.buildPTBForSimulation(tx, quote, [{ coinType: STRATEGY.principalCoinType, coin }]), 'INVALID_QUOTE')
    assert.equal(tx.getData().commands.length, before, 'commands appended before the refusal')
    return { commandsBefore: before, commandsAfter: tx.getData().commands.length }
  })

  // ST-20..ST-22 (FAILURE-MATRIX.md, second #127 review): a quote is bound to the env it was made for.
  const POSITION = { collateralAmount: '10000000000', debtAmount: '2000000000' } // 10 vSUI / 2 SUI, never read on chain
  const prodSource = sdk.createNaviDataSource({ client, strategies: [STRATEGY] })
  const prodWith = (position) =>
    sdk.createMultiplyClient({ client, strategies: [STRATEGY], dataSource: { ...prodSource, listAccountCaps: async () => [placeholderCap], readPosition: async () => position } })
  const REPAY = { type: 'repay', amount: '100000000' }
  /** Both build entries of `engine` must refuse `quote` with INVALID_QUOTE and leave the PTB untouched. */
  async function refusedEverywhere(engine, quote) {
    const out = {}
    for (const entry of ['buildPTBForSimulation', 'buildPTB']) {
      const tx = new Transaction()
      tx.setSender(address)
      const coins = quote.estimate.inputs.map((i) => ({ coinType: i.coinType, coin: tx.splitCoins(tx.gas, [i.amount])[0] }))
      const before = tx.getData().commands.length
      const run = entry === 'buildPTB' ? engine.buildPTB(tx, quote, { coins }) : engine.buildPTBForSimulation(tx, quote, coins)
      let error
      await assert.rejects(run, (e) => ((error = e), true))
      out[entry] = { code: error.code, message: error.message, commandsBefore: before, commandsAfter: tx.getData().commands.length }
      assert.equal(error.code, 'INVALID_QUOTE', `${entry}: ${error.code} ${error.message}`)
      assert.equal(tx.getData().commands.length, before, `${entry}: commands appended before the refusal`)
    }
    return out
  }
  await scenario('ST-20 a prod quote (existing Cap) is refused by a dev client', async () => {
    const quote = await prodWith(POSITION).quote(address, STRATEGY, REPAY, constraints)
    await save('ST-20.quote.json', quote)
    assert.equal(quote.execution.env, 'prod')
    return refusedEverywhere(engineWith(POSITION), quote)
  })
  await scenario('ST-21 a dev quote (existing Cap) is refused by a prod client', async () => {
    const quote = await engineWith(POSITION).quote(address, STRATEGY, REPAY, constraints)
    await save('ST-21.quote.json', quote)
    assert.equal(quote.execution.env, 'dev')
    return refusedEverywhere(prodWith(POSITION), quote)
  })
  await scenario('ST-22 a prod create-quote is refused by a dev client even with an explicit capRegistry', async () => {
    const registry = { capRegistry: sdk.MAINNET_CAP_REGISTRY }
    const prodEngine = sdk.createMultiplyClient({ client, strategies: [STRATEGY], ...registry })
    const quote = await prodEngine.quote(address, STRATEGY, { type: 'open', amount: PRINCIPAL, targetLeverage: LEVERAGE }, constraints)
    assert.equal(quote.execution.accountCap.kind, 'create')
    const devEngine = sdk.createMultiplyClient({ client, env: 'dev', strategies: [STRATEGY], ...registry })
    const tx = new Transaction()
    tx.setSender(address)
    const coin = tx.splitCoins(tx.gas, [PRINCIPAL])[0]
    const before = tx.getData().commands.length
    await rejects(devEngine.buildPTBForSimulation(tx, quote, [{ coinType: STRATEGY.principalCoinType, coin }]), 'INVALID_QUOTE')
    assert.equal(tx.getData().commands.length, before, 'commands appended before the refusal')
    return { commandsBefore: before, commandsAfter: tx.getData().commands.length }
  })

  // LQ-05 / LQ-06 / LQ-08 (FAILURE-MATRIX.md, second #127 review): what the chain itself enforces when a flash loan and
  // a borrow come from the same reserve. Raw lending PTBs on the stage_v2 main WBTC reserve (id 32: headroom ≈ 560 sats,
  // cash ≈ 1,100 sats, about 1 USD, far below stage's 10 USD/h outflow limit, ST-13), against vSUI collateral staked
  // from gas through Volo (the stage SUI reserve takes no deposits). No SDK planning involved: this is the model the SDK
  // check encodes. Abort 3200 (the outflow limit) is never accepted as the expected abort.
  const VSUI = STRATEGY.collateralCoinType
  const DEBT_RESERVE = 32
  const STAKE_SUI = '3000000000'
  const devMain = { env: 'dev', market: 'main', client, disableCache: true }
  const ct = (t) => { const [a, ...rest] = t.split('::'); return [norm(a), ...rest].join('::') }
  async function stageReserves() {
    const market = await lending.getMarket('main', { env: 'dev', disableCache: true })
    const vsui = market.pools.find((p) => ct(p.suiCoinType) === ct(VSUI))
    const debt = market.pools.find((p) => p.id === DEBT_RESERVE)
    assert(vsui && debt, 'stage_v2 main has the vSUI and debt reserves')
    const d = debt.token.decimals
    // availableBorrow is lending's 9-decimal amount; balance is raw pool cash in the coin's decimals.
    assert(d <= 9)
    const headroom = BigInt(String(debt.availableBorrow).split('.')[0]) / 10n ** BigInt(9 - d)
    // The API's balance ("pool withdrawable balance") is what the SDK checks; it can lag the chain by a few atoms. WBTC
    // has no staking, so the Pool object's own balance is the exact cash the boundary cases below are set against.
    const pool = await client.core.getObject({ objectId: debt.contract.pool, include: { json: true } })
    const onChain = BigInt(pool.object.json.balance)
    return { vsui, debt, decimals: d, headroom, cash: onChain, apiBalance: debt.balance, availableBorrow: debt.availableBorrow, coinType: debt.suiCoinType }
  }
  /** Oracle, Volo stake, vSUI deposit, [flash], borrow, [flash repay]. Returns the status and the borrow's command range. */
  async function sameReservePTB(name, { flash, borrow }) {
    const { vsui, debt } = await stageReserves()
    const DEBT = debt.suiCoinType
    const tx = new Transaction()
    tx.setSender(address)
    const cfg = await lending.getConfig({ env: 'dev', market: 'main', disableCache: true })
    const feeds = sdk.selectStrategyFeeds(cfg.oracle.feeds, { ...STRATEGY, collateralCoinType: VSUI, debtCoinType: DEBT })
    await lending.updateOraclePricesPTB(tx, feeds, { ...devMain, updatePythPriceFeeds: true })
    const volo = sdk.voloConverter({ client })
    const stake = await volo.quote({ coinIn: STRATEGY.debtCoinType, coinOut: VSUI, amountIn: STAKE_SUI, slippageBps: 50 })
    const { coinOut } = await volo.buildPTB(tx, stake, tx.splitCoins(tx.gas, [STAKE_SUI])[0], { changeRecipient: address })
    await lending.depositCoinPTB(tx, vsui, coinOut, { ...devMain, amount: Number(stake.minOutput.amount) })
    let flashCoin, receipt
    if (flash > 0n) {
      const [balance, r] = await lending.flashloanPTB(tx, debt, Number(flash), devMain)
      flashCoin = tx.moveCall({ target: '0x2::coin::from_balance', typeArguments: [DEBT], arguments: [balance] })
      receipt = r
    }
    const borrowAt = tx.getData().commands.length
    const borrowed = await lending.borrowCoinPTB(tx, debt, Number(borrow), devMain)
    const borrowEnd = tx.getData().commands.length
    if (receipt) {
      tx.mergeCoins(flashCoin, [borrowed])
      const repayWith = tx.moveCall({ target: '0x2::coin::into_balance', typeArguments: [DEBT], arguments: [flashCoin] })
      const [left] = await lending.repayFlashLoanPTB(tx, debt, receipt, repayWith, devMain)
      tx.transferObjects([tx.moveCall({ target: '0x2::coin::from_balance', typeArguments: [DEBT], arguments: [left] })], address)
    } else tx.transferObjects([borrowed], address)
    tx.setGasBudget(500_000_000)
    let status
    try {
      status = txOf(await simulateRaw(name, tx)).status
    } catch (error) {
      status = { success: false, error: String(error.message) } // tx.build dry-runs, an abort can surface there
    }
    await save(`${name}.status.json`, { status, borrowCommands: [borrowAt, borrowEnd], flash, borrow })
    const text = JSON.stringify(status)
    if (text.includes('3200')) throw new Error(`stage outflow limit hit (abort 3200), environment limit, not a result: ${text}`)
    return { status, text, borrowCommands: [borrowAt, borrowEnd] }
  }
  /** The abort happened in one of the borrow's commands ("in Nth command", 1-based). */
  function abortedIn(r, [from, to]) {
    const m = /in (\d+)(?:st|nd|rd|th) command/.exec(r.text)
    assert(m, `no command index in ${r.text}`)
    const n = Number(m[1]) - 1
    assert(n >= from && n < to, `aborted in command ${n}, borrow is [${from}, ${to}): ${r.text}`)
  }
  const reserveDetail = (r) => ({ coinType: r.coinType, decimals: r.decimals, availableBorrow: r.availableBorrow, headroomRaw: r.headroom, poolBalanceRaw: r.cash, apiBalanceRaw: r.apiBalance })
  await scenario('LQ-05 flash + borrow above the headroom, borrow below it, within cash: the chain accepts it', async () => {
    const reserve = await stageReserves()
    const borrow = (reserve.headroom * 8n) / 10n
    const flash = (reserve.headroom + reserve.cash) / 2n - borrow
    assert(borrow > 0n && flash > 0n && flash + borrow > reserve.headroom && flash + borrow < reserve.cash, `stage reserve no longer separates headroom and cash: ${json(reserveDetail(reserve))}`)
    const r = await sameReservePTB('LQ-05', { flash, borrow })
    assert.equal(r.status.success, true, r.text)
    return { reserve: reserveDetail(reserve), flash, borrow, flashPlusBorrow: flash + borrow }
  })
  await scenario('LQ-06 flash + borrow above cash, borrow within headroom: the borrow aborts on the cash', async () => {
    const reserve = await stageReserves()
    const borrow = (reserve.headroom * 8n) / 10n
    const flash = reserve.cash - borrow + 1n // one atom above the pool's cash
    const r = await sameReservePTB('LQ-06', { flash, borrow })
    assert.equal(r.status.success, false, 'must abort')
    abortedIn(r, r.borrowCommands)
    assert.match(r.text, /balance/, r.text)
    return { reserve: reserveDetail(reserve), flash, borrow, status: r.text.slice(0, 400) }
  })
  await scenario('LQ-08 a borrow above the headroom with cash to spare: the borrow aborts on the cap', async () => {
    const reserve = await stageReserves()
    const borrow = reserve.headroom + 10n
    assert(borrow < reserve.cash)
    const r = await sameReservePTB('LQ-08', { flash: 0n, borrow })
    assert.equal(r.status.success, false, 'must abort')
    abortedIn(r, r.borrowCommands)
    assert.match(r.text, /validate_borrow/, r.text)
    return { reserve: reserveDetail(reserve), borrow, status: r.text.slice(0, 400) }
  })

  let seed
  await scenario('ST-02/ST-05/ST-07/ST-12 open on stage_v2 vsui-sui with a PTB-created Cap', async () => {
    seed = await openPTB()
    const tx = Transaction.from(await seed.tx.toJSON())
    const owner = tx.moveCall({ target: `${STAGE.lending}::account::account_owner`, arguments: [seed.cap] })
    const probe = appendProbe(tx, owner, devMarket)
    finish(tx, seed.cap, seed.built.coins)
    const refs = assertNoProd(tx)
    const calls = tx.getData().commands.filter((c) => c.MoveCall).map((c) => `${norm(c.MoveCall.package)}::${c.MoveCall.module}::${c.MoveCall.function}`)
    const res = await simulate('ST-open', tx)
    const got = readProbe(res, probe, devMarket)
    const t = txOf(res)
    const capType = Object.values(res.objectTypes ?? t.objectTypes ?? {}).find((type) => type.endsWith('::account::AccountCap'))
    await save('ST-open.outcome.json', { got, quoted: seed.quote.estimate, refs, calls, capType })
    assert.equal(capType, sdk.ACCOUNT_CAP_TYPES.dev, 'ST-05: stage AccountCap type')
    assert(calls.includes(`${STAGE.oracle}::oracle_pro::update_single_price_v3`), 'oracle v3 entry')
    assert(calls.includes(`${STAGE.limiter}::navi_adaptor::verify_navi_position_healthy`), 'stage limiter')
    const pushed = tx.getData().inputs.filter((i) => i.Pure).length // feed ids are pure inputs
    assert(pushed > 0)
    assert(got.collateral > 0n && got.debt > 0n, 'position opened')
    assert(got.hf >= Number(constraints.minHealthFactor), `HF ${got.hf}`)
    assert(got.collateral + 1000n >= BigInt(seed.quote.execution.minCollateralAfter))
    const quotedHf = Number(seed.quote.estimate.healthFactor)
    assert(Math.abs(got.hf - quotedHf) / quotedHf < 0.01, `HF chain ${got.hf} vs quote ${quotedHf}`)
    return { hf: got.hf, quotedHf, collateral: got.collateral, debt: got.debt, leverage: seed.quote.estimate.leverage, packages: refs.packages }
  })

  await scenario('ST-07 without the RR push the same open aborts 1502', async () => {
    const ownOnly = {
      ...dev,
      async prepareOracle(tx, strategy, market) {
        const feeds = sdk.selectStrategyFeeds(market.config.oracle.feeds, strategy).filter((f) => !sdk.isRatioFeed(f))
        await lending.updateOraclePricesPTB(tx, feeds, { env: 'dev', market: strategy.market, client, updatePythPriceFeeds: true, disableCache: true })
      }
    }
    const s = await openPTB(ownOnly)
    finish(s.tx, s.cap, s.built.coins)
    // tx.build dry-runs the PTB, so the abort can surface there or in the simulation.
    let status
    try {
      const res = await simulateRaw('ST-07.no-rr', s.tx)
      assert.equal(txOf(res).status.success, false, 'must fail without the RR feed')
      status = JSON.stringify(txOf(res).status)
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error
      status = String(error.message)
    }
    await save('ST-07.no-rr.status.json', status)
    assert(/abort code: 1502|"abortCode":"1502"/.test(status), `expected abort 1502, got ${status}`)
    // Not the ST-16 race: the RR is not pushed at all, so it stays hours old on chain.
    return { status: status.slice(0, 300) }
  })

  async function lifecycle(name, action, check) {
    // A fresh open per run: an earlier PTB carries Pyth data that is already too old (ST-16).
    seed = await openPTB()
    const tx0 = Transaction.from(await seed.tx.toJSON())
    const owner0 = tx0.moveCall({ target: `${STAGE.lending}::account::account_owner`, arguments: [seed.cap] })
    const p0 = appendProbe(tx0, owner0, devMarket)
    finish(tx0, seed.cap, seed.built.coins)
    const st = readProbe(await simulate(`${name}.seed`, tx0, false), p0, devMarket)
    const engine = engineWith({ collateralAmount: st.collateral.toString(), debtAmount: st.debt.toString() })
    const quote = await engine.quote(address, STRATEGY, action, constraints)
    await save(`${name}.quote.json`, quote)
    const tx = Transaction.from(await seed.tx.toJSON())
    const coins = quote.estimate.inputs.map((input) => ({ ...input, coin: tx.splitCoins(tx.gas, [input.amount])[0] }))
    const built = await engine.buildPTB(tx, quote, { coins, accountCap: seed.cap })
    const owner = tx.moveCall({ target: `${STAGE.lending}::account::account_owner`, arguments: [seed.cap] })
    const probe = appendProbe(tx, owner, devMarket)
    finish(tx, seed.cap, [...seed.built.coins, ...built.coins])
    assertNoProd(tx)
    const got = readProbe(await simulate(name, tx), probe, devMarket)
    await save(`${name}.outcome.json`, { before: st, got, quoted: quote.estimate })
    check(got, st, quote)
    return { before: { c: st.collateral, d: st.debt, hf: st.hf }, after: { c: got.collateral, d: got.debt, hf: got.hf }, quotedLeverage: quote.estimate.leverage }
  }
  const lev = (p) => Number(p.collateral) * 1.0 / Math.max(1, Number(p.collateral) - Number(p.debt) / 1.07)
  await scenario('ST-12 add_principal keeps leverage', () =>
    lifecycle('ST-add', { type: 'add_principal', amount: PRINCIPAL }, (got, st) => {
      assert(got.collateral > st.collateral && got.debt > st.debt)
      assert(got.hf >= Number(constraints.minHealthFactor))
      assert(Math.abs(lev(got) - lev(st)) < 0.05, `leverage ${lev(st)} -> ${lev(got)}`)
    })
  )
  await scenario('ST-12 remove_principal', () =>
    lifecycle('ST-remove', { type: 'remove_principal', amount: '900000000' }, (got, st) => {
      assert(got.collateral < st.collateral && got.debt <= st.debt)
      assert(got.hf >= Number(constraints.minHealthFactor))
    })
  )
  await scenario('ST-12 close', () =>
    lifecycle('ST-close', { type: 'close' }, (got) => {
      assert.equal(got.collateral, 0n)
      assert.equal(got.debt, 0n)
    })
  )
} catch (error) {
  report.scenarios.push({ name: 'bootstrap', status: 'failed', error: error.stack ?? String(error) })
  console.error(error.message)
} finally {
  report.finishedAt = new Date().toISOString()
  report.success = report.scenarios.length > 0 && report.scenarios.every((s) => s.status === 'passed')
  await save('report.json', report)
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n', { flag: 'wx' })
  console.log(`Evidence: ${out}`)
  console.log(`${report.scenarios.filter((s) => s.status === 'passed').length} passed / ${report.scenarios.filter((s) => s.status === 'failed').length} failed`)
  if (!report.success) process.exitCode = 1
}
