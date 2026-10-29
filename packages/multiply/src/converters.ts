import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import {
  getQuote,
  buildSwapPTBFromQuote,
  COMPOSABLE_SWAP_API_VERSION,
  type Quote as AstrosQuote,
  type SwapOptions
} from '@naviprotocol/astros-aggregator-sdk'
import type {
  Converter,
  ConversionQuote,
  ConversionRequest,
  CoinInput,
  MultiplySuiClient
} from './types'
import { defaultClient } from './data-source'
import { SUI, VSUI, HASUI } from './strategies'
import { address, check, coinType, inspect, minOutputGuard, sameCoin, uint } from './utils'

const VOLO = {
  package: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
  pool: '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
  metadata: '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60'
}
const HAEDAL = {
  package: '0x19e6ea7f5ced4f090e20da794cc80349a03e638940ddb95155a4e301f5f4967c',
  config: '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca'
}
function request(input: ConversionRequest) {
  uint(input.amountIn, false)
  check(
    Number.isInteger(input.slippageBps) && input.slippageBps >= 0 && input.slippageBps < 10000,
    'INVALID_ARGUMENT',
    'Invalid converter slippage'
  )
  return input
}
function quoted(
  id: string,
  req: ConversionRequest,
  amount: string,
  data: unknown
): ConversionQuote {
  uint(amount, false)
  const min = ((BigInt(amount) * BigInt(10000 - req.slippageBps)) / 10000n).toString()
  uint(min, false)
  return {
    converterId: id,
    input: { coinType: coinType(req.coinIn), amount: req.amountIn },
    expectedOutput: { coinType: coinType(req.coinOut), amount },
    minOutput: { coinType: coinType(req.coinOut), amount: min },
    expiresAt: Date.now() + 120_000,
    data
  }
}
export function validateConversion(q: ConversionQuote, req: ConversionRequest, id: string) {
  check(
    q.converterId === id &&
      sameCoin(q.input.coinType, req.coinIn) &&
      sameCoin(q.expectedOutput.coinType, req.coinOut) &&
      sameCoin(q.minOutput.coinType, req.coinOut) &&
      q.input.amount === req.amountIn,
    'INVALID_CONVERSION',
    'Converter returned a mismatched pair or amount'
  )
  const expected = uint(q.expectedOutput.amount, false),
    min = uint(q.minOutput.amount, false)
  check(
    min <= expected && min >= (expected * BigInt(10000 - req.slippageBps)) / 10000n,
    'INVALID_CONVERSION',
    'Converter minimum exceeds the slippage budget'
  )
  check(
    Number.isSafeInteger(q.expiresAt) && q.expiresAt > Date.now(),
    'QUOTE_EXPIRED',
    'Conversion quote expired'
  )
}
function pair(lst: string, a: string, b: string) {
  return (sameCoin(a, SUI) && sameCoin(b, lst)) || (sameCoin(a, lst) && sameCoin(b, SUI))
}
export function voloConverter(options: { client?: MultiplySuiClient } = {}): Converter {
  const client = options.client ?? defaultClient()
  return {
    id: 'volo',
    supports: (a, b) => pair(VSUI, a, b),
    async quote(input) {
      const req = request(input),
        stake = sameCoin(req.coinIn, SUI)
      check(pair(VSUI, req.coinIn, req.coinOut), 'CONVERTER_UNAVAILABLE', 'Unsupported Volo pair')
      const { object } = await client.core.getObject({
        objectId: VOLO.pool,
        include: { json: true }
      })
      const manage = object.json?.manage as { paused?: boolean } | undefined
      check(manage?.paused === false, 'CONVERTER_UNAVAILABLE', 'Volo is paused or unreadable')
      const tx = new Transaction()
      tx.moveCall({
        target: `${VOLO.package}::stake_pool::get_amount_out`,
        arguments: [
          tx.object(VOLO.pool),
          tx.object(VOLO.metadata),
          tx.pure.u64(req.amountIn),
          tx.pure.bool(stake)
        ]
      })
      const result = await inspect(client, tx)
      const amount = bcs.u64().parse(result[0].returnValues[0].bcs)
      check(
        BigInt(stake ? req.amountIn : amount) >= 1_000_000_000n,
        'CONVERTER_UNAVAILABLE',
        'Volo requires at least 1 SUI input or redemption output'
      )
      return quoted('volo', req, amount, { version: 1, stake })
    },
    async buildPTB(tx, q, coinIn) {
      check(
        q.converterId === 'volo' &&
          pair(VSUI, q.input.coinType, q.expectedOutput.coinType) &&
          q.expiresAt > Date.now(),
        'INVALID_CONVERSION',
        'Invalid or expired Volo quote'
      )
      const coinOut = tx.moveCall({
        target: `${VOLO.package}::stake_pool::${sameCoin(q.input.coinType, SUI) ? 'stake' : 'unstake'}`,
        arguments: [tx.object(VOLO.pool), tx.object(VOLO.metadata), tx.object('0x5'), coinIn]
      })
      minOutputGuard(tx, coinOut, q.minOutput.amount)
      return { coinOut, change: [] }
    }
  }
}
export function haedalConverter(options: { client?: MultiplySuiClient } = {}): Converter {
  const client = options.client ?? defaultClient()
  return {
    id: 'haedal',
    supports: (a, b) => pair(HASUI, a, b),
    async quote(input) {
      const req = request(input),
        stake = sameCoin(req.coinIn, SUI)
      check(
        pair(HASUI, req.coinIn, req.coinOut),
        'CONVERTER_UNAVAILABLE',
        'Unsupported Haedal pair'
      )
      // Haedal staking::MIN_STAKING_THRESHOLD (EStakeNotEnoughSui = 4).
      // The rate getter accepts smaller amounts, but request_stake_coin does not.
      check(
        !stake || BigInt(req.amountIn) >= 1_000_000_000n,
        'CONVERTER_UNAVAILABLE',
        'Haedal requires at least 1 SUI staking input'
      )
      const { object } = await client.core.getObject({
        objectId: HAEDAL.config,
        include: { json: true }
      })
      const state = object.json
      check(
        state && state[stake ? 'pause_stake' : 'pause_unstake'] === false,
        'CONVERTER_UNAVAILABLE',
        'Haedal is paused or unreadable'
      )
      const config = state.config as Record<string, string>
      const feeRate = uint(config[stake ? 'deposit_fee' : 'service_fee'])
      const denominator = 10_000_000n // Haedal FEE_DENOMINATOR, independent of exchange-rate scale.
      check(feeRate < denominator, 'CONVERTER_UNAVAILABLE', 'Invalid Haedal fee')
      const amountIn = BigInt(req.amountIn)
      const tx = new Transaction()
      tx.moveCall({
        target: `${HAEDAL.package}::staking::${stake ? 'get_stsui_by_sui' : 'get_sui_by_stsui'}`,
        arguments: [
          tx.object(HAEDAL.config),
          tx.pure.u64((stake ? amountIn - (amountIn * feeRate) / denominator : amountIn).toString())
        ]
      })
      const result = await inspect(client, tx)
      const gross = BigInt(bcs.u64().parse(result[0].returnValues[0].bcs))
      const net = stake ? gross : gross - (gross * feeRate) / denominator
      if (!stake) {
        const vault = state.sui_vault as { cache_pool?: string }
        check(
          vault && gross <= uint(vault.cache_pool),
          'CONVERTER_UNAVAILABLE',
          'Haedal instant redemption liquidity is insufficient'
        )
      }
      return quoted('haedal', req, net.toString(), {
        version: 1,
        stake,
        feeRate: feeRate.toString(),
        feeDenominator: denominator.toString()
      })
    },
    async buildPTB(tx, q, coinIn) {
      check(
        q.converterId === 'haedal' &&
          pair(HASUI, q.input.coinType, q.expectedOutput.coinType) &&
          q.expiresAt > Date.now(),
        'INVALID_CONVERSION',
        'Invalid or expired Haedal quote'
      )
      const stake = sameCoin(q.input.coinType, SUI)
      const args = [tx.object('0x5'), tx.object(HAEDAL.config), coinIn]
      if (stake) args.push(tx.pure.address(address('0x0')))
      const coinOut = tx.moveCall({
        target: `${HAEDAL.package}::staking::${stake ? 'request_stake_coin' : 'request_unstake_instant_coin'}`,
        arguments: args
      })
      minOutputGuard(tx, coinOut, q.minOutput.amount)
      return { coinOut, change: [] }
    }
  }
}
export function astrosConverter(
  options: { apiKey?: string; baseUrl?: string; services?: SwapOptions['services'] } = {}
): Converter {
  check(
    COMPOSABLE_SWAP_API_VERSION === 1,
    'CONVERTER_UNAVAILABLE',
    'Astros dependency does not support composable swaps'
  )
  const safe = (v: unknown) => {
    const n = uint(String(v), false)
    check(
      n <= BigInt(Number.MAX_SAFE_INTEGER),
      'CONVERTER_UNAVAILABLE',
      'Astros route exceeds the SDK safe-integer limit'
    )
    return Number(n)
  }
  function validateRoute(route: AstrosQuote) {
    safe(route.amount_in)
    safe(route.amount_out)
    check(route.routes?.length > 0, 'CONVERTER_UNAVAILABLE', 'Astros returned no routes')
    for (const r of route.routes) {
      safe(r.amount_in)
      safe(r.amount_out)
    }
  }
  return {
    id: 'astros',
    supports: (a, b) => !sameCoin(a, b),
    async quote(input) {
      const req = request(input)
      safe(req.amountIn)
      const route = await getQuote(req.coinIn, req.coinOut, req.amountIn, options.apiKey, {
        baseUrl: options.baseUrl,
        services: options.services,
        byAmountIn: true
      })
      validateRoute(route)
      check(
        String(route.amount_in) === req.amountIn,
        'INVALID_CONVERSION',
        'Astros changed input amount'
      )
      return quoted('astros', req, String(route.amount_out), { version: 1, route })
    },
    async buildPTB(tx, q, coinIn) {
      check(
        q.converterId === 'astros' && q.expiresAt > Date.now(),
        'INVALID_CONVERSION',
        'Invalid or expired Astros quote'
      )
      const data = q.data as { version: number; route: AstrosQuote }
      check(data?.version === 1, 'INVALID_CONVERSION', 'Unknown Astros quote version')
      const route = data.route
      validateRoute(route)
      check(
        sameCoin(route.from, q.input.coinType) &&
          sameCoin(route.target, q.expectedOutput.coinType) &&
          String(route.amount_in) === q.input.amount &&
          String(route.amount_out) === q.expectedOutput.amount,
        'INVALID_CONVERSION',
        'Astros payload differs from the frozen quote'
      )
      const change: CoinInput[] = []
      const coinOut = await buildSwapPTBFromQuote(
        address('0x0'),
        tx,
        safe(q.minOutput.amount),
        coinIn as Parameters<typeof buildSwapPTBFromQuote>[3],
        route,
        0,
        false,
        options.apiKey,
        {
          services: options.services,
          positiveSlippage: false,
          onCoinChange: (coin, type) => change.push({ coinType: coinType(type), coin })
        }
      )
      minOutputGuard(tx, coinOut, q.minOutput.amount)
      return { coinOut, change }
    }
  }
}
