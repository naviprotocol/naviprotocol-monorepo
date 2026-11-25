// Read-only mainnet simulation. Never signs or broadcasts.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { getMarket } from '@naviprotocol/lending'
import { resolveEMode } from '../dist/emode.js'
import {
  createMultiplyClient,
  createNaviDataSource,
  SUI,
  VSUI,
  MAINNET_CAP_REGISTRY
} from '../dist/index.js'
const address =
  process.env.MULTIPLY_E2E_ADDRESS ??
  '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const stable = process.env.MULTIPLY_E2E_PAIR === 'usdsui'
const out =
  process.env.MULTIPLY_E2E_OUT ??
  `/private/tmp/multiply-emode-${stable ? 'usdsui' : 'vsui'}-simulation`
await mkdir(out, { recursive: true })
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443'
})
const strategy = {
  id: 'main-vsui-sui',
  market: 'main',
  registryKey: { strategyNumericId: '4', strategyVersion: '2' },
  emodeId: 0,
  principalCoinType: SUI,
  collateralCoinType: VSUI,
  debtCoinType: SUI
}
if (stable)
  Object.assign(strategy, {
    id: 'main-usdsui-usdc',
    emodeId: 2,
    registryKey: { strategyNumericId: '7', strategyVersion: '2' },
    principalCoinType:
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    collateralCoinType:
      '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
  })
const amount = stable ? '100000' : '100000000'
const retiredRegistryKeys = ['1', '2', '3', '4', '5', '6', '7'].map((strategyNumericId) => ({
  strategyNumericId,
  strategyVersion: '1'
}))
const source = createNaviDataSource({ client, strategies: [strategy], retiredRegistryKeys })
const engine = createMultiplyClient({
  client,
  strategies: [strategy],
  retiredRegistryKeys,
  dataSource: source
})
const report = { broadcast: false, address, scenarios: [] }
const save = async (name, value) =>
  writeFile(
    `${out}/${name}.json`,
    JSON.stringify(
      value,
      (_, v) =>
        typeof v === 'bigint'
          ? String(v)
          : v instanceof Uint8Array
            ? { base64: Buffer.from(v).toString('base64') }
            : v,
      2
    )
  )
try {
  const quote = await engine.quote(
    address,
    strategy,
    { type: 'open', amount, targetLeverage: '5' },
    { minHealthFactor: '1.05', maxSlippageBps: 50 }
  )
  await save('quote', quote)
  report.scenarios.push({
    name: `${strategy.id}-5x-quote`,
    status: 'passed',
    risk: {
      ltv: quote.execution.market.ltv,
      lt: quote.execution.market.liquidationThreshold,
      borrowWeight: quote.execution.market.borrowWeight
    }
  })
  const liveMarket = await getMarket('main', { disableCache: true })
  liveMarket.getEMode = () => null
  await assert.rejects(
    resolveEMode(
      client,
      strategy,
      quote.execution.market.config,
      liveMarket,
      quote.execution.market.collateral,
      quote.execution.market.debt
    ),
    /Active E-Mode missing from market catalogue/
  )
  report.scenarios.push({ name: `${strategy.id}-targeted-group-read`, status: 'passed' })
  assert.equal(quote.execution.accountCap.kind, 'create')
  const tx = new Transaction()
  tx.setSender(address)
  tx.setGasBudget(300000000)
  let input = tx.gas
  if (stable) {
    const coins = await client.core.listCoins({
      owner: address,
      coinType: strategy.principalCoinType
    })
    const coin = coins.objects.find((c) => BigInt(c.balance) >= BigInt(amount))
    assert(coin, 'Wallet has no USDC coin sufficient for simulation')
    input = tx.object(coin.objectId)
  }
  const coin = tx.splitCoins(input, [amount])[0]
  const built = await engine.buildPTB(tx, quote, {
    coins: [{ coinType: strategy.principalCoinType, coin }]
  })
  const config = quote.execution.market.config
  const capOwner = tx.moveCall({
    target: `${config.package}::account::account_owner`,
    arguments: [built.createdAccountCap]
  })
  const modeIndex = tx.getData().commands.length
  tx.moveCall({
    target: `${config.package}::storage::get_user_emode_id`,
    arguments: [tx.object(config.storage), capOwner]
  })
  const hfIndex = tx.getData().commands.length
  tx.moveCall({
    target: `${config.package}::logic::user_health_factor`,
    arguments: [
      tx.object('0x6'),
      tx.object(config.storage),
      tx.object(config.priceOracle),
      capOwner
    ]
  })
  const valuesIndex = tx.getData().commands.length
  for (const [fn, asset] of [
    ['user_collateral_value', quote.execution.market.collateral.id],
    ['user_loan_value', quote.execution.market.debt.id]
  ])
    tx.moveCall({
      target: `${config.package}::logic::${fn}`,
      arguments: [
        tx.object('0x6'),
        tx.object(config.priceOracle),
        tx.object(config.storage),
        tx.pure.u8(asset),
        capOwner
      ]
    })
  const registryIndex = tx.getData().commands.length
  tx.moveCall({
    target: `${MAINNET_CAP_REGISTRY.packageId}::multiply_registry::find_user_mul_account_caps`,
    arguments: [tx.object(MAINNET_CAP_REGISTRY.objectId), tx.pure.address(address)]
  })
  tx.transferObjects([built.createdAccountCap, ...built.coins.map((c) => c.coin)], address)
  const bytes = await tx.build({ client })
  await save('commands', tx.getData())
  const result = await client.core.simulateTransaction({
    transaction: bytes,
    checksEnabled: true,
    include: { effects: true, events: true, commandResults: true, balanceChanges: true }
  })
  await save('simulation', result)
  const status = (result.Transaction ?? result.FailedTransaction).status
  assert.equal(status.success, true, JSON.stringify(status))
  const value = (i, j = 0) => result.commandResults[i].returnValues[j].bcs
  assert.equal(bcs.u64().parse(value(modeIndex)), String(strategy.emodeId))
  const hf = Number(bcs.u256().parse(value(hfIndex))) / 1e27
  assert(hf > 1.05)
  const recomputedHF =
    (Number(bcs.u256().parse(value(valuesIndex))) *
      Number(quote.execution.market.liquidationThreshold)) /
    (Number(bcs.u256().parse(value(valuesIndex + 1))) * Number(quote.execution.market.borrowWeight))
  assert(
    Math.abs(hf - recomputedHF) < 1e-6,
    'HF must match the same simulation balances, E-Mode LT and borrow weight'
  )
  const keys = bcs.vector(bcs.u64()).parse(value(registryIndex))
  const versions = bcs.vector(bcs.u64()).parse(value(registryIndex, 1))
  assert(keys.some((id, i) => id === strategy.registryKey.strategyNumericId && versions[i] === '2'))
  report.scenarios.push({
    name: `${strategy.id}-5x-new-cap`,
    status: 'passed',
    mode: strategy.emodeId,
    hf,
    recomputedHF,
    quotedHF: quote.estimate.healthFactor,
    bytesSha256: createHash('sha256').update(bytes).digest('hex')
  })
  // Fault injection: invalid mode and a failing final HF assertion must both roll back
  // application writes. Sui may still advance versions of mutable inputs on failure.
  for (const fault of ['invalid-mode', 'final-hf']) {
    const data = tx.getData()
    const command = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.function ===
          (fault === 'invalid-mode'
            ? 'enter_emode_with_account_cap'
            : 'verify_navi_position_healthy')
    ).MoveCall
    const arg = command.arguments[fault === 'invalid-mode' ? 1 : 4]
    data.inputs[arg.Input].Pure.bytes = Buffer.from(
      fault === 'invalid-mode'
        ? bcs.u64().serialize(999999).toBytes()
        : bcs.u256().serialize('2000000000000000000000000000').toBytes()
    ).toString('base64')
    const failedBytes = await Transaction.from(JSON.stringify(data)).build({ client })
    const response = await client.core.simulateTransaction({
      transaction: failedBytes,
      checksEnabled: true,
      include: { effects: true }
    })
    await save(fault, response)
    const failed = response.FailedTransaction ?? response.Transaction
    assert.equal(failed.status.success, false)
    assert(failed.effects?.changedObjects?.length, 'Failure effects must be present')
    const changed = failed.effects.changedObjects
    const gasIds = new Set(data.gasData.payment.map((coin) => coin.objectId))
    assert(
      !changed.some(
        (o) =>
          o.idOperation === 'Created' || (o.idOperation === 'Deleted' && !gasIds.has(o.objectId))
      )
    )
    assert.equal(
      failed.status.error.command,
      data.commands.findIndex((c) => c.$kind === 'MoveCall' && c.MoveCall === command)
    )
    assert(!failed.effects?.eventsDigest, 'Aborted PTB must not commit its initialization events')
    report.scenarios.push({
      name: `${strategy.id}-${fault}-rollback`,
      status: 'passed',
      error: failed.status.error
    })
  }
} catch (error) {
  report.scenarios.push({
    name: `${strategy.id}-5x-new-cap`,
    status: 'failed',
    error: error.message,
    cause: error.cause?.message
  })
  process.exitCode = 1
} finally {
  await save('report', report)
  console.log(JSON.stringify(report))
}
