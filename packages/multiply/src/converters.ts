import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import {
  getQuote,
  buildSwapPTBFromQuote,
  type Quote as AstrosQuote,
  type SwapOptions
} from '@naviprotocol/astros-aggregator-sdk'
import type { Converter, ConversionQuote, ConversionRequest, MultiplySuiClient } from './types'
import { defaultClient } from './data-source'
import { SUI, VSUI, HASUI } from './strategies'
import {
  address,
  check,
  coinType,
  inspect,
  minOutputGuard,
  sameCoin,
  uint,
  MultiplyError
} from './utils'

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
  const expected = responseUint(amount, 'INVALID_CONVERSION')
  const minimum = (expected * BigInt(10000 - req.slippageBps)) / 10000n
  check(minimum > 0n, 'CONVERSION_AMOUNT_TOO_SMALL', 'Conversion minimum rounds below one atom')
  const min = minimum.toString()
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
function poolObject(value: unknown, field: string): Record<string, unknown> {
  check(
    value && typeof value === 'object' && !Array.isArray(value),
    'READ_FAILED',
    `Invalid ${field}`
  )
  return value as Record<string, unknown>
}
function responseUint(value: unknown, code: 'READ_FAILED' | 'INVALID_CONVERSION'): bigint {
  try {
    return uint(value)
  } catch {
    throw new MultiplyError(code, 'Invalid upstream integer amount')
  }
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
      const pool = poolObject(object?.json, 'Volo pool')
      const manage = poolObject(pool.manage, 'Volo management state')
      check(typeof manage.paused === 'boolean', 'READ_FAILED', 'Invalid Volo pause state')
      check(!manage.paused, 'CONVERTER_UNAVAILABLE', 'Volo is paused')
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
        'CONVERSION_AMOUNT_TOO_SMALL',
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
        'CONVERSION_AMOUNT_TOO_SMALL',
        'Haedal requires at least 1 SUI staking input'
      )
      const { object } = await client.core.getObject({
        objectId: HAEDAL.config,
        include: { json: true }
      })
      const state = poolObject(object?.json, 'Haedal state')
      const paused = state[stake ? 'pause_stake' : 'pause_unstake']
      check(typeof paused === 'boolean', 'READ_FAILED', 'Invalid Haedal pause state')
      const config = poolObject(state.config, 'Haedal fee configuration')
      const feeRate = responseUint(config[stake ? 'deposit_fee' : 'service_fee'], 'READ_FAILED')
      const denominator = 10_000_000n // Haedal FEE_DENOMINATOR, independent of exchange-rate scale.
      check(feeRate < denominator, 'READ_FAILED', 'Invalid Haedal fee')
      const liquidity = stake
        ? null
        : responseUint(poolObject(state.sui_vault, 'Haedal vault').cache_pool, 'READ_FAILED')
      check(!paused, 'CONVERTER_UNAVAILABLE', 'Haedal is paused')
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
        // Pinned 0x19e6…967c::staking::request_unstake_instant_coin compares
        // get_sui_by_stsui(input) >= 1e9 BEFORE withdrawing and charging service_fee.
        check(
          gross >= 1_000_000_000n,
          'CONVERSION_AMOUNT_TOO_SMALL',
          'Haedal requires at least 1 SUI gross redemption output'
        )
        check(
          liquidity !== null && gross <= liquidity,
          'CONVERTER_UNAVAILABLE',
          'Haedal instant redemption liquidity is insufficient'
        )
      }
      const quote = quoted('haedal', req, net.toString(), {
        version: 1,
        stake,
        feeRate: feeRate.toString(),
        feeDenominator: denominator.toString()
      })
      quote.fees = [
        {
          coinType: coinType(SUI),
          amount: (((stake ? amountIn : gross) * feeRate) / denominator).toString(),
          feeKind: stake ? 'deposit' : 'redemption',
          includedInExpectedOutput: true
        }
      ]
      return quote
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
  const safe = (v: unknown) => {
    const n = uint(String(v), false)
    check(
      n <= BigInt(Number.MAX_SAFE_INTEGER),
      'CONVERTER_UNAVAILABLE',
      'Astros route exceeds the SDK safe-integer limit'
    )
    return Number(n)
  }
  function validateRoute(route: AstrosQuote, amountIn: string) {
    check(
      route && Array.isArray(route.routes),
      'INVALID_CONVERSION',
      'Invalid Astros route structure'
    )
    const amount = (value: unknown, allowZero = false) => {
      check(
        typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)),
        'INVALID_CONVERSION',
        'Invalid Astros amount type'
      )
      const parsed = responseUint(String(value), 'INVALID_CONVERSION')
      check(allowZero || parsed > 0n, 'INVALID_CONVERSION', 'Invalid Astros route amount')
      check(
        parsed <= BigInt(Number.MAX_SAFE_INTEGER),
        'CONVERTER_UNAVAILABLE',
        'Astros route exceeds the SDK safe-integer limit'
      )
      return parsed
    }
    amount(route.amount_in)
    check(String(route.amount_in) === amountIn, 'INVALID_CONVERSION', 'Astros changed input amount')
    const output = amount(route.amount_out, true)
    for (const r of route.routes) {
      check(r && typeof r === 'object', 'INVALID_CONVERSION', 'Invalid Astros route leg')
      amount(r.amount_in)
      amount(r.amount_out)
    }
    check(
      route.routes.length > 0 && output > 0n,
      'CONVERTER_UNAVAILABLE',
      'Astros returned no executable routes'
    )
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
      validateRoute(route, req.amountIn)
      const result = quoted('astros', req, String(route.amount_out), { version: 1, route })
      result.route = {
        provider: 'astros',
        observedAt: Date.now(),
        hops: route.routes.flatMap((r) =>
          (r.path ?? []).flatMap((hop) =>
            typeof hop.from === 'string' && typeof hop.target === 'string'
              ? [
                  {
                    coinIn: coinType(hop.from),
                    coinOut: coinType(hop.target),
                    ...(typeof hop.id === 'string' ? { poolId: hop.id } : {}),
                    ...(typeof hop.provider === 'string' ? { dex: hop.provider } : {}),
                    ...(hop.fee_rate !== undefined ? { feeRate: String(hop.fee_rate) } : {})
                  }
                ]
              : []
          )
        )
      }
      return result
    },
    async buildPTB(tx, q, coinIn, context) {
      check(context?.changeRecipient, 'INVALID_ARGUMENT', 'Astros requires a change recipient')
      const recipient = address(context.changeRecipient)
      check(recipient !== address('0x0'), 'INVALID_ARGUMENT', 'Change recipient cannot be zero')
      check(
        q.converterId === 'astros' && q.expiresAt > Date.now(),
        'INVALID_CONVERSION',
        'Invalid or expired Astros quote'
      )
      const data = q.data as { version: number; route: AstrosQuote }
      check(data?.version === 1, 'INVALID_CONVERSION', 'Unknown Astros quote version')
      const route = data.route
      validateRoute(route, q.input.amount)
      check(
        sameCoin(route.from, q.input.coinType) &&
          sameCoin(route.target, q.expectedOutput.coinType) &&
          String(route.amount_in) === q.input.amount &&
          String(route.amount_out) === q.expectedOutput.amount,
        'INVALID_CONVERSION',
        'Astros payload differs from the frozen quote'
      )
      const coinOut = await buildSwapPTBFromQuote(
        recipient,
        tx,
        safe(q.minOutput.amount),
        coinIn as Parameters<typeof buildSwapPTBFromQuote>[3],
        route,
        0,
        false,
        options.apiKey,
        { services: options.services }
      )
      minOutputGuard(tx, coinOut, q.minOutput.amount)
      return { coinOut, change: [] }
    }
  }
}
