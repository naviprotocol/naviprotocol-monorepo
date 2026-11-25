// Read-only complete SDK build on mainnet. Never signs, broadcasts or registers a live Cap.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { createMultiplyClient, createNaviDataSource, SUI, VSUI, HASUI } from '../dist/index.js'
import { voloConverter, haedalConverter, astrosConverter } from '../dist/converters.js'
const address =
  process.env.MULTIPLY_E2E_ADDRESS ??
  '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const out = process.env.MULTIPLY_E2E_OUT ?? '/private/tmp/multiply-native-snapshot-build'
await mkdir(out, { recursive: true })
const client = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443'
})
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const USDSUI = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
const definitions = [
  ['vsui', VSUI, SUI, 0],
  ['hasui', HASUI, SUI, undefined],
  ['usdsui', USDSUI, USDC, 2]
]
// Fresh simulation-only keys avoid the user's existing positions. All old keys are
// explicitly excluded from discovery; no transactions are submitted to the registry.
const retiredRegistryKeys = ['1', '2', '3', '4', '5', '6', '7'].flatMap((strategyNumericId) =>
  ['1', '2', '3'].map((strategyVersion) => ({ strategyNumericId, strategyVersion }))
)
const report = { broadcast: false, checksEnabled: true, address, scenarios: [] }
const save = (name, value) =>
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
for (const [index, [name, collateral, debt, emodeId]] of definitions.entries()) {
  try {
    const strategy = {
      id: `snapshot-test-${name}`,
      market: 'main',
      registryKey: { strategyNumericId: String(900004 + index), strategyVersion: '1' },
      ...(emodeId === undefined ? {} : { emodeId }),
      principalCoinType: debt,
      acceptedInputCoinTypes: [debt, collateral],
      collateralCoinType: collateral,
      debtCoinType: debt
    }
    const source = createNaviDataSource({ client, strategies: [strategy], retiredRegistryKeys })
    let quoteCalls = 0
    const wrap = (converter) => {
      const quote = converter.quote.bind(converter)
      converter.quote = (req) => {
        quoteCalls++
        return quote(req)
      }
      return converter
    }
    const engine = createMultiplyClient({
      client,
      strategies: [strategy],
      retiredRegistryKeys,
      dataSource: source,
      converters: [wrap(voloConverter({ client })), wrap(haedalConverter({ client }))],
      fallbackConverter: wrap(astrosConverter({ client }))
    })
    const amount = debt === SUI ? '1000000000' : '100000'
    const quote = await engine.quote(
      address,
      strategy,
      { type: 'open', amount, targetLeverage: '2' },
      { minHealthFactor: '1.05', maxSlippageBps: 50 }
    )
    await save(`${name}-quote`, quote)
    assert.equal(quote.execution.accountCap.kind, 'create')
    if (debt === SUI)
      assert.equal(quoteCalls, 0, 'Native opening must use snapshot, not a formal quote')
    const tx = new Transaction()
    tx.setSender(address)
    tx.setGasBudget(50000000)
    let input = tx.gas
    if (debt !== SUI) {
      const coins = await client.core.listCoins({ owner: address, coinType: debt })
      const coin = coins.objects.find((c) => BigInt(c.balance) >= BigInt(amount))
      if (coin) input = tx.object(coin.objectId)
      else {
        // The user's wallet has SUI but insufficient USDC. Fund the input via an
        // actual SUI -> USDC swap inside this same simulated PTB, never fake coins.
        const funding = astrosConverter({ client })
        const fundingQuote = await funding.quote({
          coinIn: SUI,
          coinOut: USDC,
          amountIn: '300000000',
          slippageBps: 50
        })
        assert(BigInt(fundingQuote.minOutput.amount) >= BigInt(amount))
        const fundingCoin = tx.splitCoins(tx.gas, ['300000000'])[0]
        const funded = await funding.buildPTB(tx, fundingQuote, fundingCoin, {
          changeRecipient: address
        })
        input = funded.coinOut
        if (funded.change.length)
          tx.transferObjects(
            funded.change.map((c) => c.coin),
            address
          )
        await save(`${name}-funding-quote`, fundingQuote)
      }
    }
    const coin = tx.splitCoins(input, [amount])[0]
    if (debt !== SUI) tx.transferObjects([input], address)
    const built = await engine.buildPTB(tx, quote, { coins: [{ coinType: debt, coin }] })
    const config = quote.execution.market.config
    const owner = tx.moveCall({
      target: `${config.package}::account::account_owner`,
      arguments: [built.createdAccountCap]
    })
    const hfIndex = tx.getData().commands.length
    tx.moveCall({
      target: `${config.package}::logic::user_health_factor`,
      arguments: [tx.object('0x6'), tx.object(config.storage), tx.object(config.priceOracle), owner]
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
          owner
        ]
      })
    tx.transferObjects([built.createdAccountCap, ...built.coins.map((c) => c.coin)], address)
    const bytes = await tx.build({ client })
    await save(`${name}-commands`, tx.getData())
    const result = await client.core.simulateTransaction({
      transaction: bytes,
      checksEnabled: true,
      include: { effects: true, events: true, commandResults: true, balanceChanges: true }
    })
    await save(`${name}-simulation`, result)
    assert.equal(
      (result.Transaction ?? result.FailedTransaction).status.success,
      true,
      JSON.stringify((result.Transaction ?? result.FailedTransaction).status)
    )
    const value = (i) => Number(bcs.u256().parse(result.commandResults[i].returnValues[0].bcs))
    if (debt === SUI) {
      const stakeIndex = tx
        .getData()
        .commands.findIndex((c) => ['stake', 'request_stake_coin'].includes(c.MoveCall?.function))
      const coinBytes = result.commandResults[stakeIndex].returnValues[0].bcs
      assert.equal(coinBytes.length, 40, 'Coin return must contain UID and u64 balance')
      const actualMint = bcs.u64().parse(coinBytes.slice(32))
      const expectedMint = quote.execution.conversions[0].expectedOutput.amount
      assert.equal(
        actualMint,
        expectedMint,
        'Native mint must equal full snapshot calculation atom-for-atom'
      )
      report.scenarios.push({
        name: `${name}-exact-mint`,
        status: 'passed',
        expectedMint,
        actualMint
      })
      // The converter guard directly follows the stake call. Make min output
      // exceed the actual minted amount by one atom, keeping all other inputs.
      const data = tx.getData()
      const guard = data.commands[stakeIndex + 1].SplitCoins
      assert(guard)
      data.inputs[guard.amounts[0].Input].Pure.bytes = Buffer.from(
        bcs
          .u64()
          .serialize((BigInt(actualMint) + 1n).toString())
          .toBytes()
      ).toString('base64')
      const bad = await client.core.simulateTransaction({
        transaction: await Transaction.from(JSON.stringify(data)).build({ client }),
        checksEnabled: true,
        include: { effects: true }
      })
      await save(`${name}-min-output`, bad)
      const status = (bad.FailedTransaction ?? bad.Transaction).status
      assert.equal(status.success, false)
      assert.equal(status.error.command, stakeIndex + 1)
      report.scenarios.push({ name: `${name}-min-output`, status: 'passed', error: status.error })
    }
    const hf = value(hfIndex) / 1e27
    const recomputedHF =
      (value(valuesIndex) * Number(quote.execution.market.liquidationThreshold)) /
      (value(valuesIndex + 1) * Number(quote.execution.market.borrowWeight))
    assert(hf > 1.05)
    assert(
      Math.abs(hf - recomputedHF) < 1e-6,
      'HF must use actual collateral/debt and protocol oracle'
    )
    report.scenarios.push({
      name,
      status: 'passed',
      formalQuoteCalls: quoteCalls,
      quotedHF: quote.estimate.healthFactor,
      hf,
      recomputedHF,
      bytesSha256: createHash('sha256').update(bytes).digest('hex')
    })
    // Mutating just the final guard must fail the same fully funded PTB.
    const data = tx.getData()
    const guardIndex = data.commands.findIndex(
      (c) => c.MoveCall?.function === 'verify_navi_position_healthy'
    )
    assert(guardIndex >= 0)
    const arg = data.commands[guardIndex].MoveCall.arguments[4]
    data.inputs[arg.Input].Pure.bytes = Buffer.from(
      bcs.u256().serialize('2000000000000000000000000000').toBytes()
    ).toString('base64')
    const rejected = await client.core.simulateTransaction({
      transaction: await Transaction.from(JSON.stringify(data)).build({ client }),
      checksEnabled: true,
      include: { effects: true }
    })
    await save(`${name}-unsafe-hf`, rejected)
    const status = (rejected.FailedTransaction ?? rejected.Transaction).status
    assert.equal(status.success, false)
    assert.equal(status.error.command, guardIndex)
    report.scenarios.push({ name: `${name}-unsafe-hf`, status: 'passed', error: status.error })
  } catch (error) {
    report.scenarios.push({
      name,
      status: 'failed',
      error: error.message,
      cause: error.cause?.message
    })
    process.exitCode = 1
  }
  await save('report', report)
  console.log(JSON.stringify(report.scenarios.slice(-2)))
}
